import path from 'node:path'
import type { ProfileInstallation } from './profileInstallation'

export const PROFILE_LIVE_GATEWAY_LOCATOR_VERSION = 1 as const
export const PROFILE_LIVE_GATEWAY_DIRECTORY_MODE = 0o700
export const PROFILE_LIVE_GATEWAY_LOCATOR_MODE = 0o600
export const PROFILE_LIVE_GATEWAY_SOCKET_MODE = 0o600
export const PROFILE_LIVE_GATEWAY_UNIX_PATH_MAX_BYTES = 103

const PROFILE_LIVE_GATEWAY_LOCATOR_FILE = 'agent-gateway.json'
const PROFILE_LIVE_GATEWAY_SOCKET_FILE = 'agent.sock'
const PROFILE_LIVE_GATEWAY_GENERATION = /^[a-f0-9]{32}$/
const PROFILE_LIVE_GATEWAY_TOKEN = /^[a-f0-9]{64}$/

export type ProfileLiveGatewayPlatform = 'darwin' | 'win32'

export type ProfileLiveGatewayPaths = Readonly<{
  profileRoot: string
  locatorPath: string
  endpoint: string
}>

export type ProfileLiveGatewayLocator = Readonly<{
  version: typeof PROFILE_LIVE_GATEWAY_LOCATOR_VERSION
  generation: string
  endpoint: string
  token: string
}>

export function resolveProfileLiveGatewayPaths(
  installation: ProfileInstallation,
  platform: ProfileLiveGatewayPlatform,
  generation: string,
): ProfileLiveGatewayPaths {
  requireGeneration(generation)
  const profileRoot = path.dirname(installation.databasePath)
  const locatorPath = path.join(profileRoot, PROFILE_LIVE_GATEWAY_LOCATOR_FILE)
  const endpoint = platform === 'darwin'
    ? path.join(profileRoot, PROFILE_LIVE_GATEWAY_SOCKET_FILE)
    : `\\\\.\\pipe\\eido-agent-${generation}`
  if (platform === 'darwin'
    && new TextEncoder().encode(endpoint).byteLength > PROFILE_LIVE_GATEWAY_UNIX_PATH_MAX_BYTES) {
    throw new Error(
      `Live Gateway Unix socket path exceeds ${PROFILE_LIVE_GATEWAY_UNIX_PATH_MAX_BYTES} UTF-8 bytes`,
    )
  }
  return Object.freeze({ profileRoot, locatorPath, endpoint })
}

export function createProfileLiveGatewayLocator(
  installation: ProfileInstallation,
  platform: ProfileLiveGatewayPlatform,
  generation: string,
  token: string,
): ProfileLiveGatewayLocator {
  if (!PROFILE_LIVE_GATEWAY_TOKEN.test(token)) {
    throw new Error('Live Gateway launch token is invalid')
  }
  return Object.freeze({
    version: PROFILE_LIVE_GATEWAY_LOCATOR_VERSION,
    generation,
    endpoint: resolveProfileLiveGatewayPaths(installation, platform, generation).endpoint,
    token,
  })
}

export function parseProfileLiveGatewayLocator(
  installation: ProfileInstallation,
  platform: ProfileLiveGatewayPlatform,
  candidate: unknown,
): ProfileLiveGatewayLocator | undefined {
  if (!isRecord(candidate)
    || !hasExactKeys(candidate, ['version', 'generation', 'endpoint', 'token'])
    || candidate.version !== PROFILE_LIVE_GATEWAY_LOCATOR_VERSION
    || typeof candidate.generation !== 'string'
    || !PROFILE_LIVE_GATEWAY_GENERATION.test(candidate.generation)
    || typeof candidate.endpoint !== 'string'
    || typeof candidate.token !== 'string'
    || !PROFILE_LIVE_GATEWAY_TOKEN.test(candidate.token)) {
    return undefined
  }
  let expected: ProfileLiveGatewayPaths
  try {
    expected = resolveProfileLiveGatewayPaths(installation, platform, candidate.generation)
  } catch {
    return undefined
  }
  if (candidate.endpoint !== expected.endpoint) return undefined
  return Object.freeze({
    version: PROFILE_LIVE_GATEWAY_LOCATOR_VERSION,
    generation: candidate.generation,
    endpoint: candidate.endpoint,
    token: candidate.token,
  })
}

function requireGeneration(generation: string): void {
  if (!PROFILE_LIVE_GATEWAY_GENERATION.test(generation)) {
    throw new Error('Live Gateway generation is invalid')
  }
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
}

function hasExactKeys(candidate: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(candidate)
  return keys.length === expected.length && expected.every((key) => (
    Object.prototype.hasOwnProperty.call(candidate, key)
  ))
}
