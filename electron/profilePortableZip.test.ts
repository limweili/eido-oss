import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { toProfileLogicalAssetPayload } from '../src/persistence/profileAssetKernel'
import { createCompleteProfileFixture } from '../src/persistence/fixtures/profileLogicalProjectionFixture'
import { projectProfileSnapshot } from '../src/persistence/profileLogicalProjection'
import {
  PROFILE_PORTABLE_ARCHIVE_PATHS,
  PROFILE_PORTABLE_ARCHIVE_V1_ENTRY_METADATA,
  planProfilePortableArchive,
  readProfilePortableArchive,
  type ProfilePortableArchivePlan,
  type ProfilePortableArchivePlannedEntry,
} from '../src/persistence/profilePortableArchive'
import {
  closeProfilePortableZipSource,
  createProfilePortableZipDestination,
  createProfilePortableZipSource,
  observeProfilePortableZip,
  writeProfilePortableZip,
  type ProfilePortableZipBlobOpener,
  type ProfilePortableZipDestination,
  type ProfilePortableZipSource,
} from './profilePortableZip'

const testRoots: string[] = []

afterEach(() => {
  for (const root of testRoots.splice(0)) removeSyntheticRoot(root)
})

describe('native Profile Portable ZIP adapter (#463)', () => {
  it('writes byte-identical classic STORE archives and admits them through the pure reader', async () => {
    const firstRoot = syntheticRoot()
    const secondRoot = syntheticRoot()
    const fixture = await portableFixture()
    const firstPath = path.join(firstRoot, 'first.eido-profile')
    const secondPath = path.join(secondRoot, 'second.eido-profile')

    await writeProfilePortableZip({
      destination: destination(firstPath, firstRoot),
      plan: fixture.plan,
      openBlob: fixture.openBlob,
    })
    await writeProfilePortableZip({
      destination: destination(secondPath, secondRoot),
      plan: fixture.plan,
      openBlob: fixture.openBlob,
    })

    expect(readFileSync(firstPath)).toEqual(readFileSync(secondPath))
    expect(readdirSync(path.join(firstRoot, 'operations'))).toEqual([])
    expect(readdirSync(firstRoot).sort()).toEqual(['first.eido-profile', 'operations'])
    const source = createProfilePortableZipSource(firstPath)
    try {
      const container = await observeProfilePortableZip(source)
      const admitted = await readProfilePortableArchive({
        container,
        sha256,
        stageBlob: async (input) => {
          const chunks: Uint8Array[] = []
          let size = 0
          const digest = createHash('sha256')
          for await (const chunk of input.bytes) {
            const copy = new Uint8Array(chunk)
            chunks.push(copy)
            size += copy.byteLength
            digest.update(copy)
          }
          return {
            content: concat(chunks, size),
            sha256: digest.digest('hex'),
            size: BigInt(size),
          }
        },
      })
      expect(admitted.manifest).toEqual(fixture.plan.manifest)
      expect(admitted.document).toEqual(JSON.parse(new TextDecoder().decode(fixture.plan.profileBytes)))
      expect(admitted.verifiedBlobs.map((blob) => blob.sha256)).toEqual(
        fixture.plan.entries.slice(2).map((entry) => (
          entry.content.kind === 'blob' ? entry.content.sha256 : 'not-a-blob'
        )),
      )
    } finally {
      closeProfilePortableZipSource(source)
    }
  })

  it('reports exact contiguous raw offsets and canonical metadata', async () => {
    const root = syntheticRoot()
    const fixture = await portableFixture()
    const archivePath = path.join(root, 'observed.eido-profile')
    await writeProfilePortableZip({
      destination: destination(archivePath, root),
      plan: fixture.plan,
      openBlob: fixture.openBlob,
    })

    const source = createProfilePortableZipSource(archivePath)
    try {
      const observed = await observeProfilePortableZip(source)
      expect(observed).toMatchObject({
        usesZip64: false,
        comment: '',
        centralDirectoryRecordsEnd: observed.endOfCentralDirectoryOffset,
        endOfCentralDirectoryEnd: observed.archiveSize,
      })
      expect(observed.endOfCentralDirectoryEnd - observed.endOfCentralDirectoryOffset).toBe(22n)
      expect(observed.entries.map((entry) => entry.path)).toEqual(fixture.plan.entries.map((entry) => entry.path))
      expect(observed.entries[0]!.localHeaderOffset).toBe(0n)
      for (let index = 1; index < observed.entries.length; index += 1) {
        expect(observed.entries[index]!.localHeaderOffset).toBe(observed.entries[index - 1]!.dataEnd)
      }
      expect(observed.entries.at(-1)!.dataEnd).toBe(observed.centralDirectoryOffset)
      for (const entry of observed.entries) {
        const isBlob = entry.path.startsWith(PROFILE_PORTABLE_ARCHIVE_PATHS.blobPrefix)
        expect(entry).toMatchObject({
          localHeaderPath: entry.path,
          headersMatch: true,
          kind: 'file',
          compression: 'store',
          encrypted: false,
          usesDataDescriptor: false,
          crc32Verified: !isBlob,
          modifiedAt: PROFILE_PORTABLE_ARCHIVE_V1_ENTRY_METADATA.modifiedAt,
          mode: PROFILE_PORTABLE_ARCHIVE_V1_ENTRY_METADATA.mode,
          comment: '',
          extraFieldIds: [],
        })
        expect(entry.crc32VerifiedOnStream).toBe(isBlob ? true : undefined)
      }
    } finally {
      closeProfilePortableZipSource(source)
    }
  })

  it('streams a payload larger than the entry buffer without whole-blob reads', async () => {
    const root = syntheticRoot()
    const base = await portableFixture()
    const bytes = new Uint8Array(1024 * 1024 + 37)
    for (let index = 0; index < bytes.byteLength; index += 1) bytes[index] = index % 251
    const digest = sha256Sync(bytes)
    const plan = withOnlyBlob(base.plan, digest, bytes.byteLength)
    let yieldedChunks = 0
    const openBlob: ProfilePortableZipBlobOpener = async function* (request) {
      expect(request).toEqual({ sha256: digest, size: bytes.byteLength })
      for (let offset = 0; offset < bytes.byteLength; offset += 17 * 1024) {
        yieldedChunks += 1
        yield bytes.subarray(offset, Math.min(bytes.byteLength, offset + 17 * 1024))
      }
    }
    const archivePath = path.join(root, 'large.eido-profile')
    await writeProfilePortableZip({
      destination: destination(archivePath, root),
      plan,
      openBlob,
    })
    expect(yieldedChunks).toBeGreaterThan(32)

    const source = createProfilePortableZipSource(archivePath)
    try {
      const [observed, concurrentObservation] = await Promise.all([
        observeProfilePortableZip(source),
        observeProfilePortableZip(source),
      ])
      expect(concurrentObservation).toBe(observed)
      const blob = observed.entries.find((entry) => entry.path.startsWith(PROFILE_PORTABLE_ARCHIVE_PATHS.blobPrefix))
      if (!blob) throw new Error('Expected streamed blob entry')
      await expect(blob.readBytes(bytes.byteLength)).rejects.toMatchObject({ code: 'bounds-exceeded' })
      const chunks: Uint8Array[] = []
      let size = 0
      for await (const chunk of blob.streamBytes(bytes.byteLength)) {
        expect(chunk.byteLength).toBeLessThanOrEqual(64 * 1024)
        chunks.push(chunk)
        size += chunk.byteLength
      }
      expect(chunks.length).toBeGreaterThan(1)
      expect(concat(chunks, size)).toEqual(bytes)
    } finally {
      closeProfilePortableZipSource(source)
    }
  })

  it('defers blob CRC verification to the single bounded staging stream', async () => {
    const root = syntheticRoot()
    const fixture = await portableFixture()
    const archivePath = path.join(root, 'deferred-crc.eido-profile')
    await writeProfilePortableZip({
      destination: destination(archivePath, root),
      plan: fixture.plan,
      openBlob: fixture.openBlob,
    })
    const originalSource = createProfilePortableZipSource(archivePath)
    let original: Awaited<ReturnType<typeof observeProfilePortableZip>>
    try {
      original = await observeProfilePortableZip(originalSource)
    } finally {
      closeProfilePortableZipSource(originalSource)
    }
    const blob = original.entries.find((entry) => (
      entry.path.startsWith(PROFILE_PORTABLE_ARCHIVE_PATHS.blobPrefix)
    ))
    if (!blob) throw new Error('Expected Portable archive blob entry')
    const changed = new Uint8Array(readFileSync(archivePath))
    changed[Number(blob.dataOffset)] ^= 1
    writeFileSync(archivePath, changed)

    const corruptSource = createProfilePortableZipSource(archivePath)
    try {
      const observed = await observeProfilePortableZip(corruptSource)
      const deferred = observed.entries.find((entry) => entry.path === blob.path)
      expect(deferred).toMatchObject({ crc32Verified: false, crc32VerifiedOnStream: true })
      if (!deferred) throw new Error('Expected deferred Portable archive blob entry')
      await expect(consume(deferred.streamBytes(Number(deferred.size)))).rejects.toMatchObject({
        code: 'integrity-mismatch',
      })
    } finally {
      closeProfilePortableZipSource(corruptSource)
    }
  })

  it.each([
    {
      name: 'trailing bytes',
      mutate(bytes: Uint8Array, _observation: Awaited<ReturnType<typeof observeProfilePortableZip>>) {
        return concat([bytes, new Uint8Array([0xff])], bytes.byteLength + 1)
      },
    },
    {
      name: 'a gap before the central directory',
      mutate(bytes: Uint8Array, observation: Awaited<ReturnType<typeof observeProfilePortableZip>>) {
        const central = Number(observation.centralDirectoryOffset)
        const changed = new Uint8Array(bytes.byteLength + 1)
        changed.set(bytes.subarray(0, central), 0)
        changed[central] = 0x7f
        changed.set(bytes.subarray(central), central + 1)
        setU32(changed, Number(observation.endOfCentralDirectoryOffset) + 1 + 16, central + 1)
        return changed
      },
    },
    {
      name: 'a prepended byte',
      mutate(bytes: Uint8Array, observation: Awaited<ReturnType<typeof observeProfilePortableZip>>) {
        const changed = new Uint8Array(bytes.byteLength + 1)
        changed[0] = 0x7f
        changed.set(bytes, 1)
        let centralCursor = Number(observation.centralDirectoryOffset) + 1
        for (const entry of observation.entries) {
          setU32(changed, centralCursor + 42, Number(entry.localHeaderOffset) + 1)
          centralCursor += 46 + new TextEncoder().encode(entry.path).byteLength
        }
        setU32(
          changed,
          Number(observation.endOfCentralDirectoryOffset) + 1 + 16,
          Number(observation.centralDirectoryOffset) + 1,
        )
        return changed
      },
    },
    {
      name: 'a duplicate EOCD',
      mutate(bytes: Uint8Array, observation: Awaited<ReturnType<typeof observeProfilePortableZip>>) {
        const eocd = bytes.subarray(Number(observation.endOfCentralDirectoryOffset))
        return concat([bytes, eocd], bytes.byteLength + eocd.byteLength)
      },
    },
    {
      name: 'ZIP64 locator metadata',
      mutate(bytes: Uint8Array, observation: Awaited<ReturnType<typeof observeProfilePortableZip>>) {
        const changed = new Uint8Array(bytes)
        setU32(changed, Number(observation.endOfCentralDirectoryOffset) - 20, 0x07064b50)
        return changed
      },
    },
    {
      name: 'unsafe absolute path metadata',
      mutate(bytes: Uint8Array, observation: Awaited<ReturnType<typeof observeProfilePortableZip>>) {
        const changed = new Uint8Array(bytes)
        changed[Number(observation.centralDirectoryOffset) + 46] = '/'.charCodeAt(0)
        return changed
      },
    },
    {
      name: 'symlink mode metadata',
      mutate(bytes: Uint8Array, observation: Awaited<ReturnType<typeof observeProfilePortableZip>>) {
        const changed = new Uint8Array(bytes)
        setU32(changed, Number(observation.centralDirectoryOffset) + 38, 0o120777 * 0x1_0000)
        return changed
      },
    },
    {
      name: 'a local-header mismatch',
      mutate(bytes: Uint8Array, observation: Awaited<ReturnType<typeof observeProfilePortableZip>>) {
        const changed = new Uint8Array(bytes)
        changed[Number(observation.entries[0]!.localHeaderOffset) + 30] ^= 1
        return changed
      },
    },
    {
      name: 'a CRC mismatch',
      mutate(bytes: Uint8Array, observation: Awaited<ReturnType<typeof observeProfilePortableZip>>) {
        const changed = new Uint8Array(bytes)
        changed[Number(observation.entries[0]!.dataOffset)] ^= 1
        return changed
      },
    },
  ])('refuses hostile physical archives: $name', async ({ mutate }) => {
    const root = syntheticRoot()
    const fixture = await portableFixture()
    const archivePath = path.join(root, 'hostile.eido-profile')
    await writeProfilePortableZip({
      destination: destination(archivePath, root),
      plan: fixture.plan,
      openBlob: fixture.openBlob,
    })
    const originalSource = createProfilePortableZipSource(archivePath)
    let observation: Awaited<ReturnType<typeof observeProfilePortableZip>>
    try {
      observation = await observeProfilePortableZip(originalSource)
    } finally {
      closeProfilePortableZipSource(originalSource)
    }
    writeFileSync(archivePath, mutate(readFileSync(archivePath), observation))

    const hostileSource = createProfilePortableZipSource(archivePath)
    try {
      await expect(observeProfilePortableZip(hostileSource)).rejects.toMatchObject({
        code: expect.stringMatching(/^(invalid|integrity-mismatch)$/),
      })
    } finally {
      closeProfilePortableZipSource(hostileSource)
    }
  })

  it('keeps the destination absent and deletes operation staging when publication fails', async () => {
    const root = syntheticRoot()
    const fixture = await portableFixture()
    const archivePath = path.join(root, 'never-visible.eido-profile')
    const operationTempRoot = path.join(root, 'operations')
    const destination = createProfilePortableZipDestination({
      archivePath,
      operationTempRoot,
      testHooks: {
        beforePublish() {
          throw new Error('synthetic publication failure')
        },
      },
    })

    await expect(writeProfilePortableZip({
      destination,
      plan: fixture.plan,
      openBlob: fixture.openBlob,
    })).rejects.toThrow('synthetic publication failure')
    expect(() => readFileSync(archivePath)).toThrow()
    expect(readdirSync(operationTempRoot)).toEqual([])
  })

  it('atomically refuses a competing destination without replacing its bytes', async () => {
    const root = syntheticRoot()
    const fixture = await portableFixture()
    const archivePath = path.join(root, 'contended.eido-profile')
    const operationTempRoot = path.join(root, 'operations')
    const competingBytes = new TextEncoder().encode('independent destination')
    const target = createProfilePortableZipDestination({
      archivePath,
      operationTempRoot,
      testHooks: {
        beforePublish() {
          writeFileSync(archivePath, competingBytes, { flag: 'wx' })
        },
      },
    })

    await expect(writeProfilePortableZip({
      destination: target,
      plan: fixture.plan,
      openBlob: fixture.openBlob,
    })).rejects.toMatchObject({ code: 'invalid' })
    expect(new Uint8Array(readFileSync(archivePath))).toEqual(competingBytes)
    expect(readdirSync(operationTempRoot)).toEqual([])
    expect(readdirSync(root).sort()).toEqual(['contended.eido-profile', 'operations'])
  })

  it('keeps path state private and rejects forged or reused capabilities', async () => {
    const root = syntheticRoot()
    const fixture = await portableFixture()
    const archivePath = path.join(root, 'opaque.eido-profile')
    const target = destination(archivePath, root)
    expect(Object.keys(target)).toEqual([])
    await writeProfilePortableZip({ destination: target, plan: fixture.plan, openBlob: fixture.openBlob })
    await expect(writeProfilePortableZip({
      destination: target,
      plan: fixture.plan,
      openBlob: fixture.openBlob,
    })).rejects.toMatchObject({ code: 'invalid' })

    const source = createProfilePortableZipSource(archivePath)
    expect(Object.keys(source)).toEqual([])
    closeProfilePortableZipSource(source)
    await expect(observeProfilePortableZip(source)).rejects.toMatchObject({ code: 'invalid' })
    await expect(observeProfilePortableZip({} as ProfilePortableZipSource)).rejects.toMatchObject({ code: 'invalid' })
    await expect(writeProfilePortableZip({
      destination: {} as ProfilePortableZipDestination,
      plan: fixture.plan,
      openBlob: fixture.openBlob,
    })).rejects.toMatchObject({ code: 'invalid' })
  })
})

async function portableFixture(): Promise<{
  plan: ProfilePortableArchivePlan
  openBlob: ProfilePortableZipBlobOpener
}> {
  const fixture = createCompleteProfileFixture()
  const blobs = new Map<string, Uint8Array>()
  const document = projectProfileSnapshot(fixture.snapshot, (asset) => {
    const encoded = asset.dataUrl.slice(asset.dataUrl.indexOf(',') + 1)
    const bytes = new Uint8Array(Buffer.from(encoded, 'base64'))
    const digest = sha256Sync(bytes)
    blobs.set(digest, bytes)
    return toProfileLogicalAssetPayload(asset, digest)
  })
  const plan = await planProfilePortableArchive({ document, sha256 })
  return {
    plan,
    openBlob: async function* (request) {
      const bytes = blobs.get(request.sha256)
      if (!bytes || bytes.byteLength !== request.size) throw new Error('Unexpected synthetic blob request')
      yield bytes
    },
  }
}

function withOnlyBlob(
  plan: ProfilePortableArchivePlan,
  digest: string,
  size: number,
): ProfilePortableArchivePlan {
  const blob: ProfilePortableArchivePlannedEntry = {
    path: `${PROFILE_PORTABLE_ARCHIVE_PATHS.blobPrefix}${digest}`,
    kind: 'file',
    compression: 'store',
    encrypted: false,
    ...PROFILE_PORTABLE_ARCHIVE_V1_ENTRY_METADATA,
    extraFieldIds: [],
    content: { kind: 'blob', sha256: digest, size },
  }
  return {
    ...plan,
    entries: Object.freeze([...plan.entries.slice(0, 2), blob]),
  }
}

function destination(
  archivePath: string,
  root: string,
): ProfilePortableZipDestination {
  return createProfilePortableZipDestination({
    archivePath,
    operationTempRoot: path.join(root, 'operations'),
  })
}

function syntheticRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'eido-portable-zip-test-'))
  testRoots.push(root)
  return root
}

function removeSyntheticRoot(root: string): void {
  const resolved = path.resolve(root)
  const allowedRoot = `${path.resolve(tmpdir())}${path.sep}`
  if (!resolved.startsWith(allowedRoot) || !path.basename(resolved).startsWith('eido-portable-zip-test-')) {
    throw new Error(`Refusing to remove non-synthetic root: ${resolved}`)
  }
  rmSync(resolved, { recursive: true, force: true })
}

function sha256(bytes: Uint8Array): string {
  return sha256Sync(bytes)
}

function sha256Sync(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

async function consume(bytes: AsyncIterable<Uint8Array>): Promise<void> {
  for await (const _chunk of bytes) {
    // Exhaustion performs deferred CRC and source-identity verification.
  }
}

function setU32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true)
}
