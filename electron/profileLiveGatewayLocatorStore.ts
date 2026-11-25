import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises'
import type { ProfileInstallation } from './profileInstallation'
import {
  PROFILE_LIVE_GATEWAY_DIRECTORY_MODE,
  PROFILE_LIVE_GATEWAY_LOCATOR_MODE,
  parseProfileLiveGatewayLocator,
  resolveProfileLiveGatewayPaths,
  type ProfileLiveGatewayLocator,
  type ProfileLiveGatewayPlatform,
} from './profileLiveGatewayLocator'

const PROFILE_LIVE_GATEWAY_LOCATOR_MAX_BYTES = 4 * 1024

export type ProfileLiveGatewayLocatorReadResult =
  | Readonly<{ state: 'found'; locator: ProfileLiveGatewayLocator }>
  | Readonly<{
      state: 'absent'
      reason: 'locator-not-found' | 'endpoint-not-found'
    }>
  | Readonly<{ state: 'rejected'; reason: 'locator-rejected' }>

export async function prepareProfileLiveGatewayDirectory(
  installation: ProfileInstallation,
  platform: ProfileLiveGatewayPlatform,
): Promise<void> {
  const paths = resolveProfileLiveGatewayPaths(
    installation,
    platform,
    '0'.repeat(32),
  )
  await mkdir(paths.profileRoot, {
    recursive: true,
    mode: PROFILE_LIVE_GATEWAY_DIRECTORY_MODE,
  })
  if (platform === 'darwin') {
    await chmod(paths.profileRoot, PROFILE_LIVE_GATEWAY_DIRECTORY_MODE)
    await requireOwnerOnlyPath(paths.profileRoot, 'directory')
  }
}

export async function publishProfileLiveGatewayLocator(
  installation: ProfileInstallation,
  platform: ProfileLiveGatewayPlatform,
  locator: ProfileLiveGatewayLocator,
): Promise<void> {
  const paths = resolveProfileLiveGatewayPaths(installation, platform, locator.generation)
  const parsed = parseProfileLiveGatewayLocator(installation, platform, locator)
  if (!parsed) throw new Error('Profile Live Gateway locator is invalid')
  if (platform === 'darwin') await requireOwnerOnlyPath(paths.profileRoot, 'directory')
  const temporaryPath = `${paths.locatorPath}.${locator.generation}.tmp`
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporaryPath, 'wx', PROFILE_LIVE_GATEWAY_LOCATOR_MODE)
    await handle.writeFile(`${JSON.stringify(parsed)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await chmod(temporaryPath, PROFILE_LIVE_GATEWAY_LOCATOR_MODE)
    if (platform === 'darwin') await requireOwnerOnlyPath(temporaryPath, 'file')
    await rename(temporaryPath, paths.locatorPath)
    if (platform === 'darwin') await requireOwnerOnlyPath(paths.locatorPath, 'file')
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

export async function readProfileLiveGatewayLocator(
  installation: ProfileInstallation,
  platform: ProfileLiveGatewayPlatform,
): Promise<ProfileLiveGatewayLocatorReadResult> {
  let paths: ReturnType<typeof resolveProfileLiveGatewayPaths>
  try {
    paths = resolveProfileLiveGatewayPaths(
      installation,
      platform,
      '0'.repeat(32),
    )
  } catch {
    // The fixed macOS socket cannot exist when its sockaddr_un path is
    // structurally unrepresentable. This is proven pre-admission absence, not
    // transport uncertainty; headless ownership still decides app contention.
    return platform === 'darwin'
      ? Object.freeze({ state: 'absent' as const, reason: 'endpoint-not-found' as const })
      : rejected()
  }
  try {
    if (platform === 'darwin') {
      await requireOwnerOnlyPath(paths.profileRoot, 'directory')
      await requireOwnerOnlyPath(paths.locatorPath, 'file')
    }
    const status = await lstat(paths.locatorPath)
    if (!status.isFile() || status.size <= 0 || status.size > PROFILE_LIVE_GATEWAY_LOCATOR_MAX_BYTES) {
      return rejected()
    }
    const json = await readFile(paths.locatorPath, 'utf8')
    const candidate = JSON.parse(json) as unknown
    const locator = parseProfileLiveGatewayLocator(installation, platform, candidate)
    return locator ? Object.freeze({ state: 'found' as const, locator }) : rejected()
  } catch (error) {
    return readErrorCode(error) === 'ENOENT'
      ? Object.freeze({ state: 'absent' as const, reason: 'locator-not-found' as const })
      : rejected()
  }
}

export async function removeProfileLiveGatewayLocator(
  installation: ProfileInstallation,
  platform: ProfileLiveGatewayPlatform,
  generation: string,
): Promise<void> {
  const current = await readProfileLiveGatewayLocator(installation, platform)
  if (current.state !== 'found' || current.locator.generation !== generation) return
  const locatorPath = resolveProfileLiveGatewayPaths(
    installation,
    platform,
    generation,
  ).locatorPath
  await unlink(locatorPath).catch((error: unknown) => {
    if (readErrorCode(error) !== 'ENOENT') throw error
  })
}

async function requireOwnerOnlyPath(
  candidate: string,
  kind: 'directory' | 'file',
): Promise<void> {
  const status = await lstat(candidate)
  const expectedKind = kind === 'directory' ? status.isDirectory() : status.isFile()
  const effectiveUserId = process.geteuid?.()
  if (!expectedKind
    || effectiveUserId === undefined
    || status.uid !== effectiveUserId
    || (status.mode & 0o077) !== 0
    || (kind === 'directory' && (status.mode & 0o700) !== 0o700)
    || (kind === 'file' && (status.mode & 0o600) !== 0o600)) {
    throw new Error(`Profile Live Gateway ${kind} permissions were rejected`)
  }
}

function rejected(): ProfileLiveGatewayLocatorReadResult {
  return Object.freeze({ state: 'rejected' as const, reason: 'locator-rejected' as const })
}

function readErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : undefined
}
