import { constants } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  unlink,
} from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_KEYCHAIN_CREDENTIAL,
  KEYCHAIN_API_KEY_MAX_BYTES,
  type KeychainCredentialName,
} from './keychainBridgeContract'

// Custody for the provider API keys a person pastes into Settings.
//
// Keys are protected by the operating system and never enter Profile data.
// Missing files are checked before requesting protected storage. A locked key
// degrades AI only, and its ciphertext is retained so it can be opened later.

/** The injected subset of the operating system's protected-storage API. */
export type ProtectedStorage = Readonly<{
  isEncryptionAvailable(): boolean | Promise<boolean>
  encryptString(plainText: string): Buffer | Promise<Buffer>
  decryptString(encrypted: Buffer): string | Promise<string>
  /** Linux's basic_text backend is refused because it does not protect keys. */
  getSelectedStorageBackend?(): string
}>

/** The protected frame. Version 1 was the readable JSON this replaced. */
export const LOCAL_CREDENTIAL_VERSION = 2 as const
export const LOCAL_CREDENTIAL_LEGACY_PLAINTEXT_VERSION = 1 as const

// One file per credential slot, each with the same protections.
const CREDENTIAL_FILE_STEMS: Readonly<Record<KeychainCredentialName, string>> = {
  openrouter: 'openrouter-api-key',
  linkup: 'linkup-api-key',
}

// A search key from a build that predates ADR 0034. Nothing reads it and no
// slot addresses it; it is deleted on the way past so an obsolete secret does
// not sit on disk forever. Best effort by design: a file that will not delete
// is not a reason to refuse to open the app, and the next launch tries again.
export const RETIRED_SEARCH_CREDENTIAL_RELATIVE_PATH = path.join(
  'credentials',
  'search-api-key.v1.json',
)

export const LOCAL_CREDENTIAL_RELATIVE_PATH = path.join(
  'credentials',
  'openrouter-api-key.v2.json',
)
export const LEGACY_PLAINTEXT_CREDENTIAL_RELATIVE_PATH = path.join(
  'credentials',
  'openrouter-api-key.v1.json',
)
export const LEGACY_SAFESTORAGE_BLOB_RELATIVE_PATH = path.join(
  'credentials',
  'openrouter-api-key.bin',
)

export async function removeRetiredSearchCredential(userDataRoot: string): Promise<void> {
  const retiredPath = path.join(userDataRoot, RETIRED_SEARCH_CREDENTIAL_RELATIVE_PATH)
  try {
    const metadata = await lstat(retiredPath, { bigint: true })
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1n) return
    await unlink(retiredPath)
  } catch {
    // Nothing above this cares whether it worked, and the retry is free.
  }
}

export function localCredentialRelativePath(credential: KeychainCredentialName): string {
  return path.join('credentials', `${CREDENTIAL_FILE_STEMS[credential]}.v2.json`)
}

export function legacyPlaintextCredentialRelativePath(
  credential: KeychainCredentialName,
): string {
  return path.join('credentials', `${CREDENTIAL_FILE_STEMS[credential]}.v1.json`)
}

// JSON escaping may expand one admitted UTF-8 byte to six ASCII bytes. Keep the
// readable-generation read bound closed over every bridge-admitted key plus the
// fixed frame. Nothing writes this shape any more; it is only ever read once,
// on the way to being replaced.
export const LEGACY_PLAINTEXT_CREDENTIAL_FILE_MAX_BYTES = (KEYCHAIN_API_KEY_MAX_BYTES * 6) + 64

/** Bounds the protected frame. Ciphertext expands the payload; base64 adds a third. */
export const LOCAL_CREDENTIAL_FILE_MAX_BYTES = 256 * 1024

/**
 * What the store found.
 *
 * `locked` is the state this whole change exists to make sayable. A caller that
 * collapses it into `absent` puts the app back where #1360 found it: Research
 * silently drops to a shallower mode and nobody is told the key was there all
 * along.
 */
export type LocalCredentialReading =
  | Readonly<{ state: 'absent' }>
  | Readonly<{ state: 'present'; apiKey: string }>
  | Readonly<{ state: 'locked' }>

export type LocalCredentialReadOptions = Readonly<{
  /**
   * Whether a readable credential from the generation this replaced may be
   * rewritten as protected on the way past. True everywhere except the
   * disposable Profile review, whose whole promise is that it cannot write to
   * the real product Profile it is pointed at. With migration refused, a
   * readable credential is still returned so the review works; it is simply
   * left where it was for an ordinary launch to migrate.
   */
  migrate?: boolean
}>

export type LocalCredentialStore = Readonly<{
  read(options?: LocalCredentialReadOptions): Promise<LocalCredentialReading>
  set(apiKey: string): Promise<void>
  clear(): Promise<void>
  migrateLegacy(apiKey: string): Promise<Readonly<{ migrated: boolean }>>
}>

type PrivateFileIdentity = Readonly<{
  device: bigint
  inode: bigint
  birthtime: bigint
  size: bigint
}>

export function createLocalCredentialStore({
  userDataRoot,
  credential = DEFAULT_KEYCHAIN_CREDENTIAL,
  protection,
}: Readonly<{
  userDataRoot: string
  credential?: KeychainCredentialName
  // Required, and injected rather than imported. Required because an optional
  // mechanism is how a readable fallback gets reintroduced by accident: a
  // caller that forgets it would silently go back to writing the key in the
  // clear. Injected because `electron/keychainNoPasswordPolicy.test.ts` fails
  // if this file ever names the API, so the wiring site stays the one place
  // that says which mechanism this is.
  protection: ProtectedStorage
}>): LocalCredentialStore {
  if (!path.isAbsolute(userDataRoot) || userDataRoot.includes('\0')) {
    throw unavailable()
  }
  const stableUserDataRoot = path.normalize(userDataRoot)
  const credentialPath = path.join(stableUserDataRoot, localCredentialRelativePath(credential))
  const legacyPlaintextPath = path.join(
    stableUserDataRoot,
    legacyPlaintextCredentialRelativePath(credential),
  )
  const credentialDirectory = path.dirname(credentialPath)
  const temporaryPath = path.join(
    credentialDirectory,
    `.${CREDENTIAL_FILE_STEMS[credential]}.v2.json.tmp`,
  )
  // Only the OpenRouter slot ever had an OS-protected-storage blob to retire.
  // Every other slot has no history. The mechanism is named here in words
  // rather than by its API, because exactly one file in this directory is
  // allowed to say that name and this is not it.
  const legacyBlobPath = credential === 'openrouter'
    ? path.join(stableUserDataRoot, LEGACY_SAFESTORAGE_BLOB_RELATIVE_PATH)
    : undefined
  let tail: Promise<void> = Promise.resolve()

  const enqueue = <Value>(operation: () => Promise<Value>): Promise<Value> => {
    const result = tail.then(
      () => shield(operation),
      () => shield(operation),
    )
    tail = result.then(() => undefined, () => undefined)
    return result
  }

  // Never called before a credential file has been found on disk. That order is
  // the #774 guarantee: asking the operating system whether it can hold a
  // secret is itself a protected-store access, and an install with no key must
  // not meet one on the way to being told it has nothing.
  const protectionUsable = async (): Promise<boolean> => {
    try {
      if (await protection.isEncryptionAvailable() !== true) return false
    } catch {
      return false
    }
    try {
      // Linux without a secret service answers "available" while encrypting
      // with a hardcoded password, which is obfuscation wearing the word
      // encryption. A secret held that way is not held, so this store refuses
      // it and reports locked rather than writing something it cannot honour.
      return protection.getSelectedStorageBackend?.() !== 'basic_text'
    } catch {
      return false
    }
  }

  const readProtectedCredential = async (): Promise<LocalCredentialReading> => {
    const identity = await capturePrivateFile(credentialPath, LOCAL_CREDENTIAL_FILE_MAX_BYTES)
    if (!identity) return Object.freeze({ state: 'absent' as const })

    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
    const handle = await open(credentialPath, constants.O_RDONLY | noFollow)
    let bytes: Buffer
    try {
      assertSamePrivateFile(
        identity,
        await captureOpenedPrivateFile(handle, LOCAL_CREDENTIAL_FILE_MAX_BYTES),
      )
      bytes = await handle.readFile()
      if (bytes.byteLength !== Number(identity.size)) throw unavailable()
      assertSamePrivateFile(
        identity,
        await requirePrivateFile(credentialPath, LOCAL_CREDENTIAL_FILE_MAX_BYTES),
      )
    } finally {
      await handle.close().catch(() => undefined)
    }

    const ciphertext = parseProtectedFrame(bytes)
    if (!await protectionUsable()) return Object.freeze({ state: 'locked' as const })
    let apiKey: string
    try {
      apiKey = await openProtectedPayload(protection, ciphertext)
    } catch {
      // Retain a key this install cannot open: it may be the person's only
      // copy, and another machine or login may be able to open it later.
      return Object.freeze({ state: 'locked' as const })
    }
    return Object.freeze({ state: 'present' as const, apiKey })
  }

  // Reads the readable generation this change replaced. Only ever reached when
  // no protected file exists, and only on the way to writing one.
  const readLegacyPlaintextCredential = async (): Promise<string> => {
    const identity = await capturePrivateFile(
      legacyPlaintextPath,
      LEGACY_PLAINTEXT_CREDENTIAL_FILE_MAX_BYTES,
    )
    if (!identity) return ''
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
    const handle = await open(legacyPlaintextPath, constants.O_RDONLY | noFollow)
    try {
      assertSamePrivateFile(
        identity,
        await captureOpenedPrivateFile(handle, LEGACY_PLAINTEXT_CREDENTIAL_FILE_MAX_BYTES),
      )
      const bytes = await handle.readFile()
      if (bytes.byteLength !== Number(identity.size)) throw unavailable()
      return parseLegacyPlaintextFrame(bytes)
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  const writeProtectedCredential = async (
    apiKey: string,
    { verifyRoundTrip = false } = {},
  ): Promise<void> => {
    requireApiKey(apiKey)
    if (!await protectionUsable()) throw unavailable()
    let ciphertext: Buffer
    try {
      ciphertext = await protection.encryptString(JSON.stringify({ apiKey }))
    } catch {
      throw unavailable()
    }
    if (!Buffer.isBuffer(ciphertext) || ciphertext.byteLength === 0) throw unavailable()
    // The one assertion that makes the promise in this file's name true. A
    // mechanism that hands back the input, or anything containing it, is not
    // encrypting; writing that would put the key on disk readable while every
    // other check passed.
    if (ciphertext.includes(Buffer.from(apiKey, 'utf8'))) throw unavailable()
    // Prove a migration can be opened before committing its replacement.
    if (verifyRoundTrip && await openProtectedPayload(protection, ciphertext) !== apiKey) {
      throw unavailable()
    }

    const bytes = Buffer.from(`${JSON.stringify({
      version: LOCAL_CREDENTIAL_VERSION,
      protected: ciphertext.toString('base64'),
    })}\n`, 'utf8')
    if (bytes.byteLength > LOCAL_CREDENTIAL_FILE_MAX_BYTES) throw unavailable()

    await requireCredentialDirectory({
      credentialDirectory,
      create: true,
      userDataRoot: stableUserDataRoot,
    })
    await requireReplaceableDestination(credentialPath)
    // A fixed app-owned temp name makes an interrupted write recoverable by the
    // next set or clear without scanning the directory.
    await removeOwnedCredentialFile(temporaryPath)
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(
        temporaryPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow,
        0o600,
      )
      await handle.writeFile(bytes)
      await handle.sync()
      await handle.close()
      handle = undefined
      if (process.platform !== 'win32') await chmod(temporaryPath, 0o600)
      await rename(temporaryPath, credentialPath)
      if (process.platform !== 'win32') await chmod(credentialPath, 0o600)
      const written = await requirePrivateFile(credentialPath, LOCAL_CREDENTIAL_FILE_MAX_BYTES)
      if (written.size !== BigInt(bytes.byteLength)) throw unavailable()
    } catch {
      await handle?.close().catch(() => undefined)
      await removeOwnedCredentialFile(temporaryPath).catch(() => undefined)
      throw unavailable()
    }

    // Only now, with protected storage committed and verified, do the readable
    // generation and the retired blob go. Ordering is the whole safety of the
    // migration: a crash anywhere above leaves the readable file untouched and
    // the next launch tries again, so nobody is asked to paste a key twice.
    await removeReadableRemnants()
  }

  const removeReadableRemnants = async (): Promise<void> => {
    await removeOwnedCredentialFileBestEffort(legacyPlaintextPath)
    if (legacyBlobPath) await removeOwnedCredentialFileBestEffort(legacyBlobPath)
  }

  const readWithMigration = async (
    { migrate = true }: LocalCredentialReadOptions = {},
  ): Promise<LocalCredentialReading> => {
    const directoryPresent = await requireCredentialDirectory({
      credentialDirectory,
      create: false,
      userDataRoot: stableUserDataRoot,
    })
    // No credentials directory means no key was ever saved. Answered without
    // touching the operating system (#774).
    if (!directoryPresent) return Object.freeze({ state: 'absent' as const })

    const protectedReading = await readProtectedCredential()
    if (protectedReading.state !== 'absent') return protectedReading

    const legacy = await readLegacyPlaintextCredential()
    // Still nothing on disk, and still nothing asked of the operating system.
    if (!legacy) return Object.freeze({ state: 'absent' as const })

    // A caller that may not write hands back what it found and changes nothing.
    if (!migrate) return Object.freeze({ state: 'present' as const, apiKey: legacy })

    // A key is here, readable, and this launch cannot protect it. Leaving it in
    // place is the only answer that cannot lose it, and `locked` is the only
    // answer that does not tell the person their key is gone.
    try {
      await writeProtectedCredential(legacy, { verifyRoundTrip: true })
    } catch {
      return Object.freeze({ state: 'locked' as const })
    }
    return Object.freeze({ state: 'present' as const, apiKey: legacy })
  }

  return Object.freeze({
    read: (options) => enqueue(() => readWithMigration(options)),
    set: (apiKey) => enqueue(() => writeProtectedCredential(apiKey)),
    clear: () => enqueue(async () => {
      const directoryPresent = await requireCredentialDirectory({
        credentialDirectory,
        create: false,
        userDataRoot: stableUserDataRoot,
      })
      if (directoryPresent) {
        await removeOwnedCredentialFile(credentialPath)
        await removeOwnedCredentialFile(temporaryPath)
        // Clearing has to clear every generation, or a key the person removed
        // comes back on the next launch through the migration path.
        await removeOwnedCredentialFile(legacyPlaintextPath)
        if (legacyBlobPath) await removeOwnedCredentialFileBestEffort(legacyBlobPath)
      }
    }),
    migrateLegacy: (apiKey) => enqueue(async () => {
      requireApiKey(apiKey)
      const existing = await readWithMigration({ migrate: true })
      // `locked` is not `absent`. Writing over a locked slot would replace a
      // key the person is still holding with a stale one from renderer storage.
      if (existing.state === 'locked') throw unavailable()
      if (existing.state === 'present') return Object.freeze({ migrated: false })
      await writeProtectedCredential(apiKey, { verifyRoundTrip: true })
      return Object.freeze({ migrated: true })
    }),
  })
}

async function openProtectedPayload(protection: ProtectedStorage, ciphertext: Buffer): Promise<string> {
  const payload: unknown = JSON.parse(await protection.decryptString(ciphertext))
  if (!isPlainRecord(payload)
    || !hasExactKeys(payload, ['apiKey'])
    || typeof payload.apiKey !== 'string') {
    throw unavailable()
  }
  requireApiKey(payload.apiKey)
  return payload.apiKey
}

async function shield<Value>(operation: () => Promise<Value>): Promise<Value> {
  try {
    return await operation()
  } catch {
    throw unavailable()
  }
}

async function requireCredentialDirectory({
  credentialDirectory,
  create,
  userDataRoot,
}: Readonly<{
  credentialDirectory: string
  create: boolean
  userDataRoot: string
}>): Promise<boolean> {
  const root = await lstat(userDataRoot, { bigint: true })
  if (root.isSymbolicLink() || !root.isDirectory()) throw unavailable()

  if (create) {
    try {
      await mkdir(credentialDirectory, { mode: 0o700 })
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) throw error
    }
  }

  let directory: Awaited<ReturnType<typeof lstat>>
  try {
    directory = await lstat(credentialDirectory)
  } catch (error) {
    if (!create && hasErrorCode(error, 'ENOENT')) return false
    throw error
  }
  if (directory.isSymbolicLink() || !directory.isDirectory()) throw unavailable()
  if (process.platform !== 'win32') {
    if (create) await chmod(credentialDirectory, 0o700)
    const mode = Number((await lstat(credentialDirectory, { bigint: true })).mode) & 0o777
    if (mode !== 0o700) throw unavailable()
  }
  return true
}

async function capturePrivateFile(
  filePath: string,
  maxBytes: number,
): Promise<PrivateFileIdentity | undefined> {
  let metadata: Awaited<ReturnType<typeof lstat>>
  try {
    metadata = await lstat(filePath, { bigint: true })
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return undefined
    throw error
  }
  if (metadata.isSymbolicLink()
    || !metadata.isFile()
    || metadata.nlink !== 1n
    || metadata.size <= 0n
    || metadata.size > BigInt(maxBytes)) {
    throw unavailable()
  }
  if (process.platform !== 'win32' && (Number(metadata.mode) & 0o777) !== 0o600) {
    throw unavailable()
  }
  return Object.freeze({
    device: metadata.dev,
    inode: metadata.ino,
    birthtime: metadata.birthtimeNs,
    size: metadata.size,
  })
}

async function requirePrivateFile(
  filePath: string,
  maxBytes: number,
): Promise<PrivateFileIdentity> {
  const identity = await capturePrivateFile(filePath, maxBytes)
  if (!identity) throw unavailable()
  return identity
}

async function captureOpenedPrivateFile(
  handle: Awaited<ReturnType<typeof open>>,
  maxBytes: number,
): Promise<PrivateFileIdentity> {
  const metadata = await handle.stat({ bigint: true })
  if (!metadata.isFile()
    || metadata.nlink !== 1n
    || metadata.size <= 0n
    || metadata.size > BigInt(maxBytes)) {
    throw unavailable()
  }
  if (process.platform !== 'win32' && (Number(metadata.mode) & 0o777) !== 0o600) {
    throw unavailable()
  }
  return Object.freeze({
    device: metadata.dev,
    inode: metadata.ino,
    birthtime: metadata.birthtimeNs,
    size: metadata.size,
  })
}

function assertSamePrivateFile(
  expected: PrivateFileIdentity,
  actual: PrivateFileIdentity,
): void {
  if (expected.device !== actual.device
    || expected.inode !== actual.inode
    || expected.birthtime !== actual.birthtime
    || expected.size !== actual.size) {
    throw unavailable()
  }
}

async function requireReplaceableDestination(filePath: string): Promise<void> {
  try {
    const metadata = await lstat(filePath, { bigint: true })
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1n) {
      throw unavailable()
    }
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error
  }
}

async function removeOwnedCredentialFile(filePath: string): Promise<void> {
  try {
    const metadata = await lstat(filePath, { bigint: true })
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1n) {
      throw unavailable()
    }
    await unlink(filePath)
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error
  }
}

async function removeOwnedCredentialFileBestEffort(filePath: string): Promise<void> {
  try {
    await removeOwnedCredentialFile(filePath)
  } catch {
    // The protected credential is already committed. Failing to remove a
    // superseded file must not roll that back; the next set, clear or launch
    // tries again.
  }
}

function parseProtectedFrame(bytes: Buffer): Buffer {
  const candidate = parseCredentialJson(bytes)
  if (!hasExactKeys(candidate, ['protected', 'version'])
    || candidate.version !== LOCAL_CREDENTIAL_VERSION
    || typeof candidate.protected !== 'string'
    || candidate.protected.length === 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(candidate.protected)) {
    throw unavailable()
  }
  return Buffer.from(candidate.protected, 'base64')
}

function parseLegacyPlaintextFrame(bytes: Buffer): string {
  const candidate = parseCredentialJson(bytes)
  if (!hasExactKeys(candidate, ['apiKey', 'version'])
    || candidate.version !== LOCAL_CREDENTIAL_LEGACY_PLAINTEXT_VERSION
    || typeof candidate.apiKey !== 'string') {
    throw unavailable()
  }
  requireApiKey(candidate.apiKey)
  return candidate.apiKey
}

function parseCredentialJson(bytes: Buffer): Record<string, unknown> {
  const text = bytes.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw unavailable()
  let candidate: unknown
  try {
    candidate = JSON.parse(text) as unknown
  } catch {
    throw unavailable()
  }
  if (!isPlainRecord(candidate)) throw unavailable()
  return candidate
}

function requireApiKey(apiKey: string): void {
  if (apiKey.length === 0
    || apiKey.trim().length === 0
    || Buffer.byteLength(apiKey, 'utf8') > KEYCHAIN_API_KEY_MAX_BYTES) {
    throw unavailable()
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sorted = [...expected].sort()
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index])
}

function unavailable(): Error {
  return new Error('Local credential storage is unavailable')
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && Reflect.get(error, 'code') === code)
}
