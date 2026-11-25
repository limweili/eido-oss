import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalCredentialStore } from './localCredentialStore'
import type { ProtectedStorage } from './localCredentialStore'

const repositoryRoot = path.resolve(import.meta.dirname, '..')

// A stand-in for the operating system's protected store that records every
// approach. Reversible on purpose: the tests below have to be able to tell a
// real refusal from a mechanism that hands the input back, and one of them
// asserts that a mechanism doing exactly that is refused.
function createRecordingProtection(
  overrides: Partial<ProtectedStorage> = {},
): ProtectedStorage & Readonly<{ touches: string[] }> {
  const touches: string[] = []
  const base: ProtectedStorage = {
    isEncryptionAvailable() {
      touches.push('isEncryptionAvailable')
      return true
    },
    encryptString(plainText) {
      touches.push('encryptString')
      return Buffer.from(`sealed:${Buffer.from(plainText, 'utf8').toString('base64')}`, 'utf8')
    },
    decryptString(encrypted) {
      touches.push('decryptString')
      const text = encrypted.toString('utf8')
      if (!text.startsWith('sealed:')) throw new Error('not sealed by this store')
      return Buffer.from(text.slice('sealed:'.length), 'base64').toString('utf8')
    },
    getSelectedStorageBackend() {
      touches.push('getSelectedStorageBackend')
      return 'kwallet'
    },
  }
  return Object.freeze({ ...base, ...overrides, touches })
}

describe('protected local AI credentials', () => {
  let userDataRoot: string

  beforeEach(async () => {
    userDataRoot = await mkdtemp(path.join(os.tmpdir(), 'eido-no-keychain-test-'))
  })

  afterEach(async () => {
    await rm(userDataRoot, { force: true, recursive: true })
  })

  it('isolates the macOS packaged smoke from the real login Keychain', async () => {
    const source = await readFile(
      path.join(repositoryRoot, 'scripts/electron/packaged-smoke.mjs'),
      'utf8',
    )
    expect(source).toContain("process.platform === 'darwin' ? ['--use-mock-keychain'] : []")
    expect(source).not.toContain('--eido-profile-review')
    const main = await readFile(path.join(repositoryRoot, 'electron/main.ts'), 'utf8')
    expect(main).not.toContain('use-mock-keychain')
  })

  it('gets, sets, and migrates the device-local key without importing Electron directly', async () => {
    const store = createLocalCredentialStore({
      userDataRoot,
      protection: createRecordingProtection(),
    })

    await expect(store.read()).resolves.toEqual({ state: 'absent' })
    await store.set('sk-local-only')
    await expect(store.read()).resolves.toEqual({ state: 'present', apiKey: 'sk-local-only' })
    await store.clear()
    await expect(store.migrateLegacy('sk-local-migrated')).resolves.toEqual({ migrated: true })
    await expect(store.read()).resolves.toEqual({ state: 'present', apiKey: 'sk-local-migrated' })

    const credentialStore = await readFile(
      path.join(repositoryRoot, 'electron/localCredentialStore.ts'),
      'utf8',
    )
    expect(credentialStore).not.toMatch(/from 'electron'/)
  })

  // Board startup asks for protected storage only after finding a credential.
  // Keep the single import and the two provider-key consumers countable.
  it('permits exactly one OS-protected-storage import, and counts every consumer', async () => {
    const electronDirectory = path.join(repositoryRoot, 'electron')

    const walk = async (directory: string): Promise<string[]> => {
      const found: string[] = []
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          found.push(...await walk(absolute))
          continue
        }
        if (!entry.isFile()) continue
        if (/\bsafeStorage\b/.test(await readFile(absolute, 'utf8'))) {
          found.push(path.relative(repositoryRoot, absolute).split(path.sep).join('/'))
        }
      }
      return found
    }

    // `main.ts` is the one wiring site. This file is the guard itself, which
    // has to name what it forbids in order to forbid it.
    expect((await walk(electronDirectory)).sort()).toEqual([
      'electron/keychainNoPasswordPolicy.test.ts',
      'electron/main.ts',
    ])

    const main = await readFile(path.join(repositoryRoot, 'electron/main.ts'), 'utf8')
    // Only the two stores ask for these operations. The OS can request
    // authorization without blocking the main process that serves Boards.
    expect(main.match(/\bsafeStorage\b/g)).toHaveLength(5)
    expect(main).not.toMatch(/safeStorage\.(encryptString|decryptString|isEncryptionAvailable)\b/)
    expect(main).toContain("const protectedStorage = process.platform === 'linux' ? safeStorage : {")
    expect(main).toContain('() => safeStorage.isAsyncEncryptionAvailable()')
    expect(main).toContain('=> safeStorage.encryptStringAsync(plainText)')
    expect(main).toContain('(await safeStorage.decryptStringAsync(ciphertext)).result')
    // The only consumers are the two provider credential stores.
    expect(main.match(/protection: protectedStorage,/g)).toHaveLength(2)
    expect(main.match(/createLocalCredentialStore\(\{/g)).toHaveLength(2)

    for (const relativePath of [
      'electron/localCredentialStore.ts',
    ]) {
      const store = await readFile(path.join(repositoryRoot, relativePath), 'utf8')
      expect(store).not.toMatch(/from 'electron'/)
    }
  })

  // (a) above, asserted as behaviour. This is the assertion that stands in for
  // the person #774 was about: they opened their Boards, they have no key, and
  // nothing they did should reach the operating system.
  it('never approaches the protected store for a Profile that holds no credential', async () => {
    const protection = createRecordingProtection()
    const store = createLocalCredentialStore({ userDataRoot, protection })

    await expect(store.read()).resolves.toEqual({ state: 'absent' })

    // Same again with the credentials directory present but empty, which is
    // what a Profile that once held a key and cleared it looks like.
    const second = createLocalCredentialStore({
      userDataRoot,
      credential: 'linkup',
      protection,
    })
    await store.clear()
    await expect(second.read()).resolves.toEqual({ state: 'absent' })

    expect(protection.touches).toEqual([])
  })

  // (b) above. A protected store that will not open must degrade the key and
  // nothing else, and it must never be reported as "no key set": that is the
  // shape that let a missing Linkup key silently move Research to a shallower
  // mode with nobody told (#1360).
  it('reports a credential it cannot open as locked, not as absent, and keeps it', async () => {
    const openable = createRecordingProtection()
    const store = createLocalCredentialStore({ userDataRoot, protection: openable })
    await store.set('sk-locked-away')

    const lockedStore = createLocalCredentialStore({
      userDataRoot,
      protection: createRecordingProtection({ isEncryptionAvailable: () => false }),
    })
    await expect(lockedStore.read()).resolves.toEqual({ state: 'locked' })
    await expect(lockedStore.set('sk-anything')).rejects.toThrow()

    // The credential is still there, and the unlocked store still opens it. A
    // locked launch that quietly discarded the key would be worse than the
    // plaintext it replaced.
    await expect(store.read()).resolves.toEqual({ state: 'present', apiKey: 'sk-locked-away' })
  })

  // The actual promise this change makes to a customer. Every other assertion
  // here is machinery; this is the sentence.
  it('never writes the key anywhere under the Profile in readable form', async () => {
    const apiKey = 'sk-or-v1-the-exact-secret-that-must-not-appear-on-disk'
    const store = createLocalCredentialStore({
      userDataRoot,
      protection: createRecordingProtection(),
    })
    await store.set(apiKey)

    const readable: string[] = []
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          await walk(absolute)
          continue
        }
        if (!entry.isFile()) continue
        const bytes = await readFile(absolute)
        if (bytes.includes(Buffer.from(apiKey, 'utf8'))
          || bytes.toString('utf8').includes(apiKey)) {
          readable.push(path.relative(userDataRoot, absolute))
        }
      }
    }
    await walk(userDataRoot)
    expect(readable).toEqual([])

    // And the file that does exist is the protected frame, mode 0600, carrying
    // nothing but a version and ciphertext.
    const credentialPath = path.join(userDataRoot, 'credentials', 'openrouter-api-key.v2.json')
    const frame = JSON.parse(await readFile(credentialPath, 'utf8')) as Record<string, unknown>
    expect(Object.keys(frame).sort()).toEqual(['protected', 'version'])
    expect(frame.version).toBe(2)
    if (process.platform !== 'win32') {
      expect((await stat(credentialPath)).mode & 0o777).toBe(0o600)
    }
  })

  // A mechanism that returns its own input passes every structural check: the
  // frame is well formed, the base64 is valid, the round trip works. It just
  // publishes the key. The store refuses it rather than write it.
  it('refuses a protection mechanism whose output still contains the key', async () => {
    const passthrough = createRecordingProtection({
      encryptString: (plainText) => Buffer.from(plainText, 'utf8'),
      decryptString: (encrypted) => encrypted.toString('utf8'),
    })
    const store = createLocalCredentialStore({ userDataRoot, protection: passthrough })
    await expect(store.set('sk-would-have-been-readable')).rejects.toThrow()
    await expect(store.read()).resolves.toEqual({ state: 'absent' })
  })

  // Linux without a secret service answers "available" and then encrypts with
  // a hardcoded password. That is obfuscation wearing the word encryption, and
  // shipping it would make this whole change decorative on that platform.
  it('refuses a protected store that is only pretending', async () => {
    const pretending = createRecordingProtection({
      getSelectedStorageBackend: () => 'basic_text',
    })
    const store = createLocalCredentialStore({ userDataRoot, protection: pretending })
    await expect(store.set('sk-not-really-protected')).rejects.toThrow()
    await expect(store.read()).resolves.toEqual({ state: 'absent' })
  })

  // Existing customers have a readable key on disk right now. Nobody may be
  // asked to paste it again, and no readable copy may survive the migration.
  it('migrates a readable credential in place and leaves no readable copy', async () => {
    const apiKey = 'sk-or-v1-already-on-this-persons-disk'
    const { mkdir, writeFile } = await import('node:fs/promises')
    const credentialsDirectory = path.join(userDataRoot, 'credentials')
    await mkdir(credentialsDirectory, { mode: 0o700, recursive: true })
    const plaintextPath = path.join(credentialsDirectory, 'openrouter-api-key.v1.json')
    await writeFile(plaintextPath, JSON.stringify({ version: 1, apiKey }), { mode: 0o600 })

    const protection = createRecordingProtection()
    const store = createLocalCredentialStore({ userDataRoot, protection })
    await expect(store.read()).resolves.toEqual({ state: 'present', apiKey })

    await expect(stat(plaintextPath)).rejects.toThrow()
    const protectedBytes = await readFile(
      path.join(credentialsDirectory, 'openrouter-api-key.v2.json'),
    )
    expect(protectedBytes.includes(Buffer.from(apiKey, 'utf8'))).toBe(false)
    // Reopened from disk by a store that shares nothing with the first.
    const reopened = createLocalCredentialStore({ userDataRoot, protection })
    await expect(reopened.read()).resolves.toEqual({ state: 'present', apiKey })
  })

  // The other half of "must not lose a key". A locked store on the launch that
  // would have migrated must leave the readable file exactly where it is, so
  // the next launch can still do the work.
  it('does not destroy a readable credential it cannot yet protect', async () => {
    const apiKey = 'sk-or-v1-cannot-protect-this-today'
    const { mkdir, writeFile } = await import('node:fs/promises')
    const credentialsDirectory = path.join(userDataRoot, 'credentials')
    await mkdir(credentialsDirectory, { mode: 0o700, recursive: true })
    const plaintextPath = path.join(credentialsDirectory, 'openrouter-api-key.v1.json')
    await writeFile(plaintextPath, JSON.stringify({ version: 1, apiKey }), { mode: 0o600 })

    const locked = createLocalCredentialStore({
      userDataRoot,
      protection: createRecordingProtection({ isEncryptionAvailable: () => false }),
    })
    await expect(locked.read()).resolves.toEqual({ state: 'locked' })
    expect(JSON.parse(await readFile(plaintextPath, 'utf8'))).toEqual({ version: 1, apiKey })

    const unlocked = createLocalCredentialStore({
      userDataRoot,
      protection: createRecordingProtection(),
    })
    await expect(unlocked.read()).resolves.toEqual({ state: 'present', apiKey })
    await expect(stat(plaintextPath)).rejects.toThrow()
  })

  // A key removed in Settings must stay removed. Clearing only the protected
  // file would let the migration path resurrect it from the readable one on
  // the next launch.
  //
  // The obvious way to write this test does not test it. Set a key first and
  // the write has already removed the readable file, so `clear` is asked to
  // remove something that is not there and passes whatever it does. The case
  // that exercises the code is a Profile that still holds only the readable
  // generation, which is every existing customer up until their first launch
  // on this build.
  it('clearing removes every generation of the credential', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const credentialsDirectory = path.join(userDataRoot, 'credentials')
    await mkdir(credentialsDirectory, { mode: 0o700, recursive: true })
    await writeFile(
      path.join(credentialsDirectory, 'openrouter-api-key.v1.json'),
      JSON.stringify({ version: 1, apiKey: 'sk-or-v1-old-generation' }),
      { mode: 0o600 },
    )
    const protection = createRecordingProtection()
    const store = createLocalCredentialStore({ userDataRoot, protection })

    await store.clear()

    expect((await readdir(credentialsDirectory)).sort()).toEqual([])
    // And it stays gone: a second store over the same root finds nothing to
    // migrate, which is what "removed" has to mean.
    await expect(
      createLocalCredentialStore({ userDataRoot, protection }).read(),
    ).resolves.toEqual({ state: 'absent' })
  })

  // The same removal, on the generation that replaced it.
  it('clearing removes a protected credential too', async () => {
    const protection = createRecordingProtection()
    const store = createLocalCredentialStore({ userDataRoot, protection })
    await store.set('sk-or-v1-new-generation')
    await store.clear()
    await expect(store.read()).resolves.toEqual({ state: 'absent' })
    expect((await readdir(path.join(userDataRoot, 'credentials'))).sort()).toEqual([])
  })

  // Migration put a write inside a read. The disposable Profile review points
  // its credential root at the real product Profile on purpose, and its whole
  // promise is that it cannot write there, so that write has to be refusable.
  it('reads a readable credential without migrating it when migration is refused', async () => {
    const apiKey = 'sk-or-v1-belongs-to-the-real-profile'
    const { mkdir, writeFile } = await import('node:fs/promises')
    const credentialsDirectory = path.join(userDataRoot, 'credentials')
    await mkdir(credentialsDirectory, { mode: 0o700, recursive: true })
    const plaintextPath = path.join(credentialsDirectory, 'openrouter-api-key.v1.json')
    await writeFile(plaintextPath, JSON.stringify({ version: 1, apiKey }), { mode: 0o600 })

    const protection = createRecordingProtection()
    const store = createLocalCredentialStore({ userDataRoot, protection })
    await expect(store.read({ migrate: false })).resolves.toEqual({ state: 'present', apiKey })

    // Nothing written, nothing removed, and the operating system never asked.
    expect((await readdir(credentialsDirectory)).sort()).toEqual(['openrouter-api-key.v1.json'])
    expect(JSON.parse(await readFile(plaintextPath, 'utf8'))).toEqual({ version: 1, apiKey })
    expect(protection.touches).toEqual([])
  })

  // Stale renderer storage must not overwrite a credential the person is still
  // holding but this launch cannot open.
  it('refuses to migrate renderer storage over a locked credential', async () => {
    const store = createLocalCredentialStore({
      userDataRoot,
      protection: createRecordingProtection(),
    })
    await store.set('sk-the-real-one')

    const locked = createLocalCredentialStore({
      userDataRoot,
      protection: createRecordingProtection({ isEncryptionAvailable: () => false }),
    })
    await expect(locked.migrateLegacy('sk-stale-from-localstorage')).rejects.toThrow(
      'Local credential storage is unavailable',
    )
    await expect(store.read()).resolves.toEqual({ state: 'present', apiKey: 'sk-the-real-one' })
  })

  it('leaves no readable temp file behind when a protected write is interrupted', async () => {
    const protection = createRecordingProtection({
      encryptString: () => {
        throw new Error('protected store went away mid-write')
      },
    })
    const store = createLocalCredentialStore({ userDataRoot, protection })
    await expect(store.set('sk-interrupted')).rejects.toThrow()
    const credentialsDirectory = path.join(userDataRoot, 'credentials')
    await expect(readdir(credentialsDirectory)).rejects.toThrow()
  })
})

describe('password-free Electron fuse policy', () => {
  it('disables cookie encryption in every packaged and signing builder', async () => {
    const builderPaths = [
      'electron-builder.yml',
      'release/packaged/production-builder.mjs',
      'release/signing-smoke/macos-builder.mjs',
      'release/signing-smoke/windows-builder.mjs',
    ] as const

    const observed: Record<string, string[]> = {}
    for (const relativePath of builderPaths) {
      const config = await readFile(path.join(repositoryRoot, relativePath), 'utf8')
      observed[relativePath] = [...config.matchAll(/enableCookieEncryption:\s*(true|false)/g)]
        .map((match) => match[1]!)
    }

    expect.soft(observed).toEqual(Object.fromEntries(
      builderPaths.map((relativePath) => [relativePath, ['false']]),
    ))

    // Eido has no authentication-cookie product dependency, so the cookie fuse
    // stays off. That is untouched by #1359: the credential stores hold their
    // own secrets and never travel through Chromium's cookie jar.
    //
    // What did change is what the packaged proof must see on disk. It used to
    // assert the credential file was the exact readable v1 fixture, which is
    // now the one shape that must never appear. It asserts the protected frame
    // and the absence of the key instead.
    const packagedSmoke = await readFile(
      path.join(repositoryRoot, 'scripts/electron/packaged-smoke.mjs'),
      'utf8',
    )
    expect({
      expectsDisabled: packagedSmoke.includes('EnableCookieEncryption is Disabled'),
      expectsEnabled: packagedSmoke.includes('EnableCookieEncryption is Enabled'),
      expectsProtectedV2File: packagedSmoke.includes('openrouter-api-key.v2.json'),
      validatesLocalV1File: packagedSmoke.includes('assertLocalCredentialFile'),
      refusesReadableKeyOnDisk: packagedSmoke.includes('assertNoReadableApiKeyOnDisk'),
      retainsCiphertextExpectation: /ciphertext|plaintextAbsent/.test(packagedSmoke),
    }).toEqual({
      expectsDisabled: true,
      expectsEnabled: false,
      expectsProtectedV2File: true,
      validatesLocalV1File: true,
      refusesReadableKeyOnDisk: true,
      retainsCiphertextExpectation: true,
    })
    expect(packagedSmoke.match(/legacySafeStorageBlobRelativePath/g)).toHaveLength(2)
    expect(packagedSmoke).toContain(
      '!existsSync(path.join(root, legacySafeStorageBlobRelativePath))',
    )
    expect(packagedSmoke.match(/legacyPlaintextCredentialRelativePath/g)).toHaveLength(2)

    const packagedProfileProof = await readFile(
      path.join(repositoryRoot, 'src/desktop/packagedProfileProof.ts'),
      'utf8',
    )
    expect(packagedProfileProof).not.toContain('round-trip through protected storage')
  })
})
