import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProtectedStorage } from './localCredentialStore'
import {
  createLocalCredentialStore,
  LEGACY_PLAINTEXT_CREDENTIAL_RELATIVE_PATH,
  LEGACY_SAFESTORAGE_BLOB_RELATIVE_PATH,
  LOCAL_CREDENTIAL_FILE_MAX_BYTES,
  LOCAL_CREDENTIAL_RELATIVE_PATH,
  localCredentialRelativePath,
  removeRetiredSearchCredential,
  RETIRED_SEARCH_CREDENTIAL_RELATIVE_PATH,
} from './localCredentialStore'

// A reversible stand-in for the OS protected store. Deliberately not a cipher:
// what these tests are about is the file, the states and the ordering, and a
// transformation whose output is obviously not the input is enough to tell a
// protected frame from a readable one. The one test that cares whether real
// encryption happened is the one that plants a passthrough and expects a
// refusal.
function protectionDouble(overrides: Partial<ProtectedStorage> = {}): ProtectedStorage {
  return Object.freeze({
    isEncryptionAvailable: () => true,
    encryptString: (plainText: string) => Buffer.from(
      `sealed:${Buffer.from(plainText, 'utf8').toString('base64')}`,
      'utf8',
    ),
    decryptString: (encrypted: Buffer) => {
      const text = encrypted.toString('utf8')
      if (!text.startsWith('sealed:')) throw new Error('not sealed by this store')
      return Buffer.from(text.slice('sealed:'.length), 'base64').toString('utf8')
    },
    ...overrides,
  })
}

function protectedFrameOf(bytes: Buffer): Record<string, unknown> {
  return JSON.parse(bytes.toString('utf8')) as Record<string, unknown>
}

describe('account-private local AI credential store', () => {
  let userDataRoot: string

  beforeEach(async () => {
    userDataRoot = await mkdtemp(path.join(os.tmpdir(), 'eido-local-credential-test-'))
  })

  afterEach(async () => {
    await rm(userDataRoot, { force: true, recursive: true })
  })

  it('atomically round-trips, replaces, and clears a protected local credential', async () => {
    const store = createLocalCredentialStore({ userDataRoot, protection: protectionDouble() })

    await expect(store.read()).resolves.toEqual({ state: 'absent' })
    await store.set('sk-first-device-key')
    await expect(store.read()).resolves.toEqual({
      state: 'present',
      apiKey: 'sk-first-device-key',
    })

    const credentialPath = path.join(userDataRoot, LOCAL_CREDENTIAL_RELATIVE_PATH)
    const frame = protectedFrameOf(await readFile(credentialPath))
    expect(Object.keys(frame).sort()).toEqual(['protected', 'version'])
    expect(frame.version).toBe(2)
    expect(await readFile(credentialPath, 'utf8')).not.toContain('sk-first-device-key')
    if (process.platform !== 'win32') {
      expect(Number((await lstat(path.dirname(credentialPath), { bigint: true })).mode) & 0o777).toBe(0o700)
      expect(Number((await lstat(credentialPath, { bigint: true })).mode) & 0o777).toBe(0o600)
    }

    await store.set('sk-replaced-device-key')
    await expect(store.read()).resolves.toEqual({
      state: 'present',
      apiKey: 'sk-replaced-device-key',
    })
    expect((await readdir(path.dirname(credentialPath))).filter((name) => name.endsWith('.tmp'))).toEqual([])

    await store.clear()
    await expect(store.read()).resolves.toEqual({ state: 'absent' })
    await expect(readFile(credentialPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('deletes a search key left behind by a build that predates ADR 0034', async () => {
    const openrouter = createLocalCredentialStore({ userDataRoot, protection: protectionDouble() })
    await openrouter.set('sk-openrouter')
    const retiredPath = path.join(userDataRoot, RETIRED_SEARCH_CREDENTIAL_RELATIVE_PATH)
    await writeFile(retiredPath, '{"version":1,"apiKey":"tvly-left-behind"}', { mode: 0o600 })

    await removeRetiredSearchCredential(userDataRoot)

    await expect(readFile(retiredPath)).rejects.toMatchObject({ code: 'ENOENT' })
    // Only the retired key goes. A Profile with nothing to clean up, or a
    // second pass over one already cleaned, is a no-op rather than a failure.
    await expect(openrouter.read()).resolves.toEqual({ state: 'present', apiKey: 'sk-openrouter' })
    await expect(removeRetiredSearchCredential(userDataRoot)).resolves.toBeUndefined()
  })

  it('keeps each named credential in its own file, with the same protection', async () => {
    const protection = protectionDouble()
    const openrouter = createLocalCredentialStore({ userDataRoot, protection })
    const linkup = createLocalCredentialStore({ userDataRoot, credential: 'linkup', protection })

    await openrouter.set('sk-openrouter')
    await linkup.set('lk-linkup')

    // One key is never mistaken for the other, in either direction.
    await expect(openrouter.read()).resolves.toEqual({ state: 'present', apiKey: 'sk-openrouter' })
    await expect(linkup.read()).resolves.toEqual({ state: 'present', apiKey: 'lk-linkup' })

    const linkupPath = path.join(userDataRoot, localCredentialRelativePath('linkup'))
    expect(linkupPath).not.toBe(path.join(userDataRoot, LOCAL_CREDENTIAL_RELATIVE_PATH))
    expect(await readFile(linkupPath, 'utf8')).not.toContain('lk-linkup')
    expect(protectedFrameOf(await readFile(linkupPath)).version).toBe(2)
    if (process.platform !== 'win32') {
      expect(Number((await lstat(linkupPath, { bigint: true })).mode) & 0o777).toBe(0o600)
    }

    // Clearing one leaves the other in place.
    await linkup.clear()
    await expect(linkup.read()).resolves.toEqual({ state: 'absent' })
    await expect(openrouter.read()).resolves.toEqual({ state: 'present', apiKey: 'sk-openrouter' })
  })

  it('never reads the legacy protected-storage blob and removes it only after a successful migration', async () => {
    const legacyPath = path.join(userDataRoot, LEGACY_SAFESTORAGE_BLOB_RELATIVE_PATH)
    await mkdir(path.dirname(legacyPath), { mode: 0o700 })
    if (process.platform !== 'win32') await chmod(path.dirname(legacyPath), 0o700)
    await writeFile(legacyPath, Buffer.from('sk-not-plaintext-safe-storage-ciphertext'), {
      mode: 0o600,
    })
    const store = createLocalCredentialStore({ userDataRoot, protection: protectionDouble() })

    await expect(store.read()).resolves.toEqual({ state: 'absent' })
    await expect(readFile(legacyPath, 'utf8')).resolves.toBe('sk-not-plaintext-safe-storage-ciphertext')

    await expect(store.migrateLegacy('sk-renderer-migration')).resolves.toEqual({ migrated: true })
    await expect(store.read()).resolves.toEqual({
      state: 'present',
      apiKey: 'sk-renderer-migration',
    })
    await expect(readFile(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps the first local credential when stale renderer state retries migration', async () => {
    const store = createLocalCredentialStore({ userDataRoot, protection: protectionDouble() })

    await expect(store.migrateLegacy('sk-first')).resolves.toEqual({ migrated: true })
    await expect(store.migrateLegacy('sk-stale')).resolves.toEqual({ migrated: false })
    await expect(store.read()).resolves.toEqual({ state: 'present', apiKey: 'sk-first' })
  })

  it('keeps the v1 credential available to retry when OS decryption is denied during migration', async () => {
    const apiKey = 'sk-synthetic-v1-credential'
    const legacyPath = path.join(userDataRoot, LEGACY_PLAINTEXT_CREDENTIAL_RELATIVE_PATH)
    const credentialPath = path.join(userDataRoot, LOCAL_CREDENTIAL_RELATIVE_PATH)
    const legacyFrame = JSON.stringify({ version: 1, apiKey })
    await mkdir(path.dirname(legacyPath), { mode: 0o700 })
    if (process.platform !== 'win32') await chmod(path.dirname(legacyPath), 0o700)
    await writeFile(legacyPath, legacyFrame, { mode: 0o600 })

    const protection = protectionDouble()
    const denied = createLocalCredentialStore({
      userDataRoot,
      protection: protectionDouble({
        isEncryptionAvailable: async () => true,
        encryptString: async (value) => protection.encryptString(value),
        decryptString: async () => { throw new Error('Synthetic Keychain denial') },
      }),
    })
    await expect(denied.read()).resolves.toEqual({ state: 'locked' })
    await expect(readFile(legacyPath, 'utf8')).resolves.toBe(legacyFrame)
    await expect(readFile(credentialPath)).rejects.toMatchObject({ code: 'ENOENT' })

    const retried = createLocalCredentialStore({ userDataRoot, protection })
    await expect(retried.read()).resolves.toEqual({ state: 'present', apiKey })
    await expect(retried.read()).resolves.toEqual({ state: 'present', apiKey })
    await expect(readFile(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('explicit clear removes the exact old app-owned blob without interpreting it', async () => {
    const legacyPath = path.join(userDataRoot, LEGACY_SAFESTORAGE_BLOB_RELATIVE_PATH)
    await mkdir(path.dirname(legacyPath), { mode: 0o700 })
    if (process.platform !== 'win32') await chmod(path.dirname(legacyPath), 0o700)
    await writeFile(legacyPath, Buffer.from([0, 1, 2, 3]), { mode: 0o600 })

    await createLocalCredentialStore({ userDataRoot, protection: protectionDouble() }).clear()

    await expect(readFile(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('clears the exact recoverable temp file left by an interrupted write', async () => {
    const credentialPath = path.join(userDataRoot, LOCAL_CREDENTIAL_RELATIVE_PATH)
    const temporaryPath = path.join(
      path.dirname(credentialPath),
      '.openrouter-api-key.v2.json.tmp',
    )
    await mkdir(path.dirname(temporaryPath), { mode: 0o700 })
    if (process.platform !== 'win32') await chmod(path.dirname(temporaryPath), 0o700)
    await writeFile(temporaryPath, '{"version":2,"protected":"c2VhbGVk"}', { mode: 0o600 })

    const store = createLocalCredentialStore({ userDataRoot, protection: protectionDouble() })
    await store.clear()

    await expect(readFile(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' })

    await writeFile(temporaryPath, '{"version":2,"protected":"c2Vjb25k"}', {
      mode: 0o600,
    })
    await store.set('sk-after-interruption')

    await expect(store.read()).resolves.toEqual({
      state: 'present',
      apiKey: 'sk-after-interruption',
    })
    await expect(readFile(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['malformed JSON', Buffer.from('{"version":2,"protected":')],
    ['the readable generation in the protected slot', Buffer.from('{"version":1,"apiKey":"sk-value"}')],
    ['extra fields', Buffer.from('{"version":2,"protected":"c2VhbGVk","path":"private"}')],
    ['non-base64 ciphertext', Buffer.from('{"version":2,"protected":"not base64!"}')],
    ['oversized bytes', Buffer.alloc(LOCAL_CREDENTIAL_FILE_MAX_BYTES + 1, 0x61)],
  ])('rejects %s without deleting or reflecting credential bytes', async (_label, bytes) => {
    const store = createLocalCredentialStore({ userDataRoot, protection: protectionDouble() })
    await store.set('sk-initial')
    const credentialPath = path.join(userDataRoot, LOCAL_CREDENTIAL_RELATIVE_PATH)
    await writeFile(credentialPath, bytes, { mode: 0o600 })
    if (process.platform !== 'win32') await chmod(credentialPath, 0o600)

    await expect(store.read()).rejects.toThrow('Local credential storage is unavailable')
    await expect(readFile(credentialPath)).resolves.toEqual(bytes)
  })

  it('rejects a non-regular credential entry', async () => {
    const credentialPath = path.join(userDataRoot, LOCAL_CREDENTIAL_RELATIVE_PATH)
    await mkdir(path.dirname(credentialPath), { mode: 0o700 })
    if (process.platform !== 'win32') await chmod(path.dirname(credentialPath), 0o700)
    await mkdir(credentialPath)

    await expect(
      createLocalCredentialStore({ userDataRoot, protection: protectionDouble() }).read(),
    ).rejects.toThrow('Local credential storage is unavailable')
  })

  it.skipIf(process.platform === 'win32')('rejects a symbolic-link credential entry', async () => {
    const credentialPath = path.join(userDataRoot, LOCAL_CREDENTIAL_RELATIVE_PATH)
    const outsidePath = path.join(userDataRoot, 'outside-credential')
    const store = createLocalCredentialStore({ userDataRoot, protection: protectionDouble() })
    await store.set('sk-initial')
    await unlink(credentialPath)
    await writeFile(outsidePath, '{"version":2,"protected":"c2VhbGVk"}', { mode: 0o600 })
    await symlink(outsidePath, credentialPath)

    await expect(store.read()).rejects.toThrow('Local credential storage is unavailable')
    await expect(store.set('sk-replacement')).rejects.toThrow('Local credential storage is unavailable')
    await expect(readFile(outsidePath, 'utf8')).resolves.toContain('c2VhbGVk')
  })

  it.skipIf(process.platform === 'win32')('refuses to migrate a readable credential reached through a symbolic link', async () => {
    const legacyPath = path.join(userDataRoot, LEGACY_PLAINTEXT_CREDENTIAL_RELATIVE_PATH)
    const outsidePath = path.join(userDataRoot, 'outside-plaintext')
    await mkdir(path.dirname(legacyPath), { mode: 0o700 })
    if (process.platform !== 'win32') await chmod(path.dirname(legacyPath), 0o700)
    await writeFile(outsidePath, '{"version":1,"apiKey":"sk-somewhere-else"}', { mode: 0o600 })
    await symlink(outsidePath, legacyPath)

    const store = createLocalCredentialStore({ userDataRoot, protection: protectionDouble() })
    await expect(store.read()).rejects.toThrow('Local credential storage is unavailable')
    // The pointed-at file is left exactly as it was: the migration path may
    // delete only the app's own regular file, never whatever a link aims at.
    await expect(readFile(outsidePath, 'utf8')).resolves.toContain('sk-somewhere-else')
  })
})
