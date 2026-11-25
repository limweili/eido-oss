import { describe, expect, it } from 'vitest'
import {
  createCompleteProfileFixture,
  createProfileAgentEventFixture,
} from './fixtures/profileLogicalProjectionFixture'
import {
  hydrateProfileLogicalDocument,
  projectProfileSnapshot,
  type ProfileLogicalDocument,
} from './profileLogicalProjection'
import type { ProfileJsonValue } from './profileServiceContract'
import {
  PROFILE_PORTABLE_ARCHIVE_PATHS,
  PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS,
  planProfilePortableArchive,
  readProfilePortableArchive,
  type ProfilePortableArchiveBlobStager,
  type ProfilePortableArchiveContainerEntry,
  type ProfilePortableArchiveContainerObservation,
  type ProfilePortableArchivePlan,
} from './profilePortableArchive'

describe('Profile Portable Archive v1 (#463)', () => {
  it('prepares one deterministic complete logical archive with code-unit ordering', async () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    snapshot.profileSettings.push(
      {
        id: '\uE000-setting',
        recordVersion: 1,
        classification: 'portable-profile',
        value: { marker: 'private-use' },
      },
      {
        id: '😀-setting',
        recordVersion: 1,
        classification: 'portable-profile',
        value: { marker: 'surrogate-pair' },
      },
    )
    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
    const reversed = { ...clone(document), records: [...clone(document.records)].reverse() }

    const first = await planProfilePortableArchive({ document, sha256 })
    const second = await planProfilePortableArchive({ document: reversed, sha256 })

    expect(first.manifestBytes).toEqual(second.manifestBytes)
    expect(first.profileBytes).toEqual(second.profileBytes)
    expect(first.entries.map((entry) => entry.path)).toEqual([
      PROFILE_PORTABLE_ARCHIVE_PATHS.manifest,
      PROFILE_PORTABLE_ARCHIVE_PATHS.profile,
      `blobs/sha256/${'1'.repeat(64)}`,
      `blobs/sha256/${'2'.repeat(64)}`,
    ])
    expect(first.manifest.assets).toEqual([
      { logicalAssetId: 'asset-note-image', sha256: '1'.repeat(64), size: 68 },
      { logicalAssetId: 'asset-retired-image', sha256: '2'.repeat(64), size: 16 },
    ])
    expect(first.manifest.integrity).toMatchObject({ algorithm: 'sha256' })
    expect(first.manifest).toMatchObject({
      version: 1,
      profile: { versions: { record: 2 } },
    })
    expect(JSON.stringify(first.manifest)).not.toContain('dataUrl')

    const canonicalProfile = JSON.parse(new TextDecoder().decode(first.profileBytes)) as ProfileLogicalDocument
    const orderedIds = canonicalProfile.records.map((record) => record.recordId)
    expect(orderedIds.indexOf('😀-setting')).toBeLessThan(orderedIds.indexOf('\uE000-setting'))
  })

  it('admits one fully verified normalized container observation', async () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const plan = await planProfilePortableArchive({ document, sha256 })
    const observed = observePlan(plan)

    const admitted = await readProfilePortableArchive({
      container: observed.container,
      sha256,
      stageBlob: observed.stageBlob,
    })

    expect(admitted.manifest).toEqual(plan.manifest)
    expect(admitted.document).toEqual(JSON.parse(new TextDecoder().decode(plan.profileBytes)))
    expect(admitted.verifiedBlobs.map((entry) => entry.path)).toEqual(plan.entries.slice(2).map((entry) => entry.path))
    expect(observed.reads()).toBe(2)
    expect(observed.streams()).toBe(2)
  })

  it('preserves Profile-owned Agent history through the complete Portable archive round-trip', async () => {
    const fixture = createCompleteProfileFixture()
    const event = createProfileAgentEventFixture(fixture.snapshot.profileId)
    const snapshot = clone(fixture.snapshot)
    snapshot.profileAgentEvents = [event]
    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
    const plan = await planProfilePortableArchive({ document, sha256 })
    const observed = observePlan(plan)

    const admitted = await readProfilePortableArchive({
      container: observed.container,
      sha256,
      stageBlob: observed.stageBlob,
    })
    const hydrated = hydrateProfileLogicalDocument(admitted.document, fixture.hydrateAsset)

    expect(admitted.document.records).toContainEqual(expect.objectContaining({
      kind: 'profile-agent-event',
      recordId: event.recordId,
      ownerId: fixture.snapshot.profileId,
      recordVersion: 2,
    }))
    expect(hydrated.profileAgentEvents).toEqual([event])
  })

  it('preserves trusted Run attribution while accepting legacy Runs without it', async () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    const attributed = snapshot.boards['idea-main']!.runs.find((run) => run.id === 'run-main')!
    attributed.triggeredBy = { kind: 'agent', client: 'codex-desktop', sessionId: 'session-721' }
    const legacy = snapshot.boards['idea-main']!.runs.find((run) => run.id === 'run-conversation')!
    const plan = await planProfilePortableArchive({
      document: projectProfileSnapshot(snapshot, fixture.projectAsset),
      sha256,
    })
    const observed = observePlan(plan)

    const admitted = await readProfilePortableArchive({
      container: observed.container,
      sha256,
      stageBlob: observed.stageBlob,
    })
    const hydrated = hydrateProfileLogicalDocument(admitted.document, fixture.hydrateAsset)
    const runs = hydrated.boards['idea-main']!.runs

    expect(runs.find((run) => run.id === 'run-main')?.triggeredBy).toEqual(attributed.triggeredBy)
    expect(runs.find((run) => run.id === legacy.id)?.triggeredBy).toBeUndefined()
  })

  it('rejects malformed or non-agent Run attribution at logical projection', () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    const run = snapshot.boards['idea-main']!.runs.find((candidate) => candidate.id === 'run-main')!
    ;(run as unknown as { triggeredBy: unknown }).triggeredBy = {
      kind: 'user',
      client: 'untrusted-content',
      sessionId: 'session-721',
    }

    expect(() => projectProfileSnapshot(snapshot, fixture.projectAsset)).toThrow(/not a current Run/)
  })

  it('refuses an embedded Profile record-axis v1 without translating the v1 archive envelope', async () => {
    const fixture = createCompleteProfileFixture()
    const plan = await planProfilePortableArchive({
      document: projectProfileSnapshot(fixture.snapshot, fixture.projectAsset),
      sha256,
    })
    expect(plan.manifest.version).toBe(1)
    expect(plan.manifest.profile.versions.record).toBe(2)

    const retiredManifest = clone(plan.manifest) as unknown as {
      version: number
      profile: { versions: { record: number } }
    }
    retiredManifest.profile.versions.record = 1
    const observed = observePlan(plan, {
      [PROFILE_PORTABLE_ARCHIVE_PATHS.manifest]: canonicalBytes(retiredManifest),
    })

    await expect(readProfilePortableArchive({
      container: observed.container,
      sha256,
      stageBlob: observed.stageBlob,
    })).rejects.toMatchObject({ code: 'invalid' })
    expect(retiredManifest.version).toBe(1)
    expect(observed.reads()).toBe(1)
    expect(observed.streams()).toBe(0)
  })

  it('does not expose blob bytes that can change after digest admission', async () => {
    const fixture = createCompleteProfileFixture()
    const plan = await planProfilePortableArchive({
      document: projectProfileSnapshot(fixture.snapshot, fixture.projectAsset),
      sha256,
    })
    const blob = plan.entries[2]!
    if (blob.content.kind !== 'blob') throw new Error('Expected planned blob')
    const liveBytes = new Uint8Array(blob.content.size).fill(7)
    const original = new Uint8Array(liveBytes)
    const observed = observePlan(plan, { [blob.path]: liveBytes })

    const admitted = await readProfilePortableArchive({
      container: observed.container,
      sha256,
      stageBlob: observed.stageBlob,
    })
    liveBytes.fill(9)

    const laterBytes = admitted.verifiedBlobs[0]!.content.readBytes()
    expect(laterBytes).toEqual(original)
  })

  const hostileMetadataCases: ReadonlyArray<Readonly<{
    name: string
    mutate: (container: MutableObservation) => void
  }>> = [
    {
      name: 'case-colliding name',
      mutate(container) {
        container.entries[1] = { ...container.entries[1]!, path: 'MANIFEST.JSON', localHeaderPath: 'MANIFEST.JSON' }
      },
    },
    {
      name: 'traversal name',
      mutate(container) {
        container.entries[0] = { ...container.entries[0]!, path: '../manifest.json', localHeaderPath: '../manifest.json' }
      },
    },
    {
      name: 'backslash name',
      mutate(container) {
        container.entries[0] = { ...container.entries[0]!, path: '..\\manifest.json', localHeaderPath: '..\\manifest.json' }
      },
    },
    {
      name: 'symlink',
      mutate(container) {
        container.entries[0] = { ...container.entries[0]!, kind: 'symlink' }
      },
    },
    {
      name: 'compression',
      mutate(container) {
        container.entries[0] = { ...container.entries[0]!, compression: 'compressed' }
      },
    },
    {
      name: 'encryption',
      mutate(container) {
        container.entries[0] = { ...container.entries[0]!, encrypted: true }
      },
    },
    {
      name: 'data descriptor',
      mutate(container) {
        container.entries[0] = { ...container.entries[0]!, usesDataDescriptor: true }
      },
    },
    {
      name: 'unverified CRC',
      mutate(container) {
        container.entries[0] = { ...container.entries[0]!, crc32Verified: false }
      },
    },
    {
      name: 'local header mismatch',
      mutate(container) {
        container.entries[0] = { ...container.entries[0]!, headersMatch: false }
      },
    },
    {
      name: 'comment',
      mutate(container) {
        container.entries[0] = { ...container.entries[0]!, comment: 'hidden' }
      },
    },
    {
      name: 'extra field',
      mutate(container) {
        container.entries[0] = { ...container.entries[0]!, extraFieldIds: [1] }
      },
    },
    {
      name: 'overlap',
      mutate(container) {
        container.entries[1] = {
          ...container.entries[1]!,
          localHeaderOffset: container.entries[0]!.dataEnd - 1n,
        }
      },
    },
    {
      name: 'unaccounted archive gap',
      mutate(container) {
        container.centralDirectoryOffset += 1n
      },
    },
    {
      name: 'noncanonical order',
      mutate(container) {
        const first = container.entries[0]!
        container.entries[0] = { ...container.entries[1]!, centralDirectoryOrdinal: 0 }
        container.entries[1] = { ...first, centralDirectoryOrdinal: 1 }
      },
    },
    {
      name: 'classic ZIP limit overflow',
      mutate(container) {
        container.archiveSize = 0x1_0000_0000n
        container.centralDirectoryRecordsEnd = container.archiveSize - 22n
        container.endOfCentralDirectoryOffset = container.centralDirectoryRecordsEnd
        container.endOfCentralDirectoryEnd = container.archiveSize
      },
    },
    {
      name: 'ZIP64 envelope',
      mutate(container) {
        container.usesZip64 = true
      },
    },
    {
      name: 'archive comment',
      mutate(container) {
        container.comment = 'hidden'
      },
    },
    {
      name: 'junk between central records and EOCD',
      mutate(container) {
        container.endOfCentralDirectoryOffset += 1n
        container.endOfCentralDirectoryEnd += 1n
        container.archiveSize += 1n
      },
    },
    {
      name: 'trailing junk after EOCD',
      mutate(container) {
        container.archiveSize += 1n
      },
    },
  ]

  it.each(hostileMetadataCases)('rejects hostile container metadata before reading: $name', async ({ mutate }) => {
    const fixture = createCompleteProfileFixture()
    const plan = await planProfilePortableArchive({
      document: projectProfileSnapshot(fixture.snapshot, fixture.projectAsset),
      sha256,
    })
    const observed = observePlan(plan)
    const mutable = mutableObservation(observed.container)
    mutate(mutable)

    await expect(readProfilePortableArchive({
      container: mutable,
      sha256,
      stageBlob: observed.stageBlob,
    })).rejects.toMatchObject({ code: expect.any(String) })
    expect(observed.reads()).toBe(0)
    expect(observed.streams()).toBe(0)
  })

  it('rejects noncanonical JSON, future versions, changed integrity, and changed blob content', async () => {
    const fixture = createCompleteProfileFixture()
    const plan = await planProfilePortableArchive({
      document: projectProfileSnapshot(fixture.snapshot, fixture.projectAsset),
      sha256,
    })

    const withBom = observePlan(plan, {
      [PROFILE_PORTABLE_ARCHIVE_PATHS.manifest]: concatBytes(new Uint8Array([0xef, 0xbb, 0xbf]), plan.manifestBytes),
    })
    await expect(readProfilePortableArchive({
      container: withBom.container,
      sha256,
      stageBlob: withBom.stageBlob,
    })).rejects.toMatchObject({ code: 'invalid' })

    const futureManifest = clone(plan.manifest) as unknown as Record<string, unknown>
    futureManifest.version = 2
    const future = observePlan(plan, {
      [PROFILE_PORTABLE_ARCHIVE_PATHS.manifest]: canonicalBytes(futureManifest),
    })
    await expect(readProfilePortableArchive({
      container: future.container,
      sha256,
      stageBlob: future.stageBlob,
    })).rejects.toMatchObject({
      code: 'unsupported-future-version',
    })

    const changedRoot = clone(plan.manifest) as unknown as {
      integrity: { algorithm: 'sha256'; root: string }
    }
    changedRoot.integrity.root = '0'.repeat(64)
    const wrongRoot = observePlan(plan, {
      [PROFILE_PORTABLE_ARCHIVE_PATHS.manifest]: canonicalBytes(changedRoot),
    })
    await expect(readProfilePortableArchive({
      container: wrongRoot.container,
      sha256,
      stageBlob: wrongRoot.stageBlob,
    })).rejects.toMatchObject({
      code: 'integrity-mismatch',
    })

    const wrongBlob = observePlan(plan, {}, new Map([[plan.entries[2]!.path, 'f'.repeat(64)]]))
    await expect(readProfilePortableArchive({
      container: wrongBlob.container,
      sha256,
      stageBlob: wrongBlob.stageBlob,
    })).rejects.toMatchObject({
      code: 'integrity-mismatch',
    })
  })

  it('applies one explicit depth bound to canonical manifest and Profile JSON', async () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    let nested: Record<string, unknown> = {}
    for (let index = 0; index <= PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxJsonDepth; index += 1) {
      nested = { child: nested }
    }
    snapshot.profileSettings[0]!.value = nested as ProfileJsonValue
    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)

    await expect(planProfilePortableArchive({ document, sha256 })).rejects.toMatchObject({
      code: 'bounds-exceeded',
    })
  })
})

type MutableObservation = {
  archiveSize: bigint
  centralDirectoryOffset: bigint
  centralDirectoryRecordsEnd: bigint
  endOfCentralDirectoryOffset: bigint
  endOfCentralDirectoryEnd: bigint
  usesZip64: boolean
  comment: string
  entries: ProfilePortableArchiveContainerEntry[]
}

function observePlan(
  plan: ProfilePortableArchivePlan,
  byteOverrides: Readonly<Record<string, Uint8Array>> = {},
  digestOverrides: ReadonlyMap<string, string> = new Map(),
): {
  container: ProfilePortableArchiveContainerObservation
  stageBlob: ProfilePortableArchiveBlobStager<SyntheticStableBlob>
  reads(): number
  streams(): number
} {
  let readCount = 0
  let streamCount = 0
  let cursor = 0n
  const entries = plan.entries.map((planned, index): ProfilePortableArchiveContainerEntry => {
    const defaultBytes = planned.content.kind === 'bytes' ? planned.content.bytes : undefined
    const bytes = byteOverrides[planned.path] ?? defaultBytes
    const size = BigInt(bytes?.byteLength ?? (planned.content.kind === 'blob' ? planned.content.size : 0))
    const localHeaderOffset = cursor
    const dataOffset = localHeaderOffset + 30n + BigInt(new TextEncoder().encode(planned.path).byteLength)
    const dataEnd = dataOffset + size
    cursor = dataEnd
    return {
      path: planned.path,
      localHeaderPath: planned.path,
      headersMatch: true,
      centralDirectoryOrdinal: index,
      kind: planned.kind,
      compression: planned.compression,
      encrypted: planned.encrypted,
      usesDataDescriptor: false,
      crc32Verified: planned.path.startsWith(PROFILE_PORTABLE_ARCHIVE_PATHS.blobPrefix) ? false : true,
      ...(planned.path.startsWith(PROFILE_PORTABLE_ARCHIVE_PATHS.blobPrefix)
        ? { crc32VerifiedOnStream: true as const }
        : {}),
      compressedSize: size,
      size,
      localHeaderOffset,
      dataOffset,
      dataEnd,
      modifiedAt: planned.modifiedAt,
      mode: planned.mode,
      comment: planned.comment,
      extraFieldIds: planned.extraFieldIds,
      async readBytes() {
        readCount += 1
        if (!bytes) throw new Error(`Blob ${planned.path} must be streamed, not materialized`)
        return new Uint8Array(bytes)
      },
      async *streamBytes(maxBytes) {
        streamCount += 1
        if (size > BigInt(maxBytes)) throw new Error(`Blob ${planned.path} exceeds its stream bound`)
        yield new Uint8Array(bytes ?? new Uint8Array(Number(size)))
      },
    }
  })
  const centralDirectoryOffset = cursor
  const centralDirectoryRecordsEnd = entries.reduce((offset, entry) => (
    offset + 46n + BigInt(new TextEncoder().encode(entry.path).byteLength)
  ), centralDirectoryOffset)
  const endOfCentralDirectoryOffset = centralDirectoryRecordsEnd
  const endOfCentralDirectoryEnd = endOfCentralDirectoryOffset + 22n
  const archiveSize = endOfCentralDirectoryEnd
  const stageBlob: ProfilePortableArchiveBlobStager<SyntheticStableBlob> = async (input) => {
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of input.bytes) {
      const copy = new Uint8Array(chunk)
      chunks.push(copy)
      size += copy.byteLength
    }
    const stableBytes = concatMany(chunks, size)
    return {
      content: stableBlob(stableBytes),
      sha256: digestOverrides.get(input.path) ?? input.expectedSha256,
      size: BigInt(size),
    }
  }
  return {
    container: {
      archiveSize,
      centralDirectoryOffset,
      centralDirectoryRecordsEnd,
      endOfCentralDirectoryOffset,
      endOfCentralDirectoryEnd,
      usesZip64: false,
      comment: '',
      entries,
    },
    stageBlob,
    reads: () => readCount,
    streams: () => streamCount,
  }
}

function mutableObservation(container: ProfilePortableArchiveContainerObservation): MutableObservation {
  return {
    archiveSize: container.archiveSize,
    centralDirectoryOffset: container.centralDirectoryOffset,
    centralDirectoryRecordsEnd: container.centralDirectoryRecordsEnd,
    endOfCentralDirectoryOffset: container.endOfCentralDirectoryOffset,
    endOfCentralDirectoryEnd: container.endOfCentralDirectoryEnd,
    usesZip64: container.usesZip64,
    comment: container.comment,
    entries: [...container.entries],
  }
}

type SyntheticStableBlob = Readonly<{
  readBytes(): Uint8Array
}>

function stableBlob(bytes: Uint8Array): SyntheticStableBlob {
  const stable = new Uint8Array(bytes)
  return Object.freeze({ readBytes: () => new Uint8Array(stable) })
}

function concatMany(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(sortJson(value)))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)) {
    sorted[key] = sortJson(record[key])
  }
  return sorted
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.byteLength + right.byteLength)
  result.set(left, 0)
  result.set(right, left.byteLength)
  return result
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}
