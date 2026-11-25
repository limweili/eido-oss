import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProfileInstallation } from './profileInstallation'
import {
  PROFILE_LIVE_GATEWAY_DIRECTORY_MODE,
  PROFILE_LIVE_GATEWAY_LOCATOR_MODE,
  PROFILE_LIVE_GATEWAY_SOCKET_MODE,
  createProfileLiveGatewayLocator,
  parseProfileLiveGatewayLocator,
  resolveProfileLiveGatewayPaths,
} from './profileLiveGatewayLocator'

const generation = '0123456789abcdef0123456789abcdef'
const token = 'ab'.repeat(32)

describe('live Profile Gateway locator contract', () => {
  it('keeps the macOS endpoint and owner-only locator inside the installed Profile root', () => {
    const installation = syntheticInstallation('/private/tmp/eido-live-gateway')

    const paths = resolveProfileLiveGatewayPaths(installation, 'darwin', generation)
    const locator = createProfileLiveGatewayLocator(installation, 'darwin', generation, token)

    expect(paths).toEqual({
      profileRoot: path.join(installation.userDataRoot, 'profiles', 'default'),
      locatorPath: path.join(
        installation.userDataRoot,
        'profiles',
        'default',
        'agent-gateway.json',
      ),
      endpoint: path.join(
        installation.userDataRoot,
        'profiles',
        'default',
        'agent.sock',
      ),
    })
    expect(locator).toEqual({
      version: 1,
      generation,
      endpoint: paths.endpoint,
      token,
    })
    expect(PROFILE_LIVE_GATEWAY_DIRECTORY_MODE).toBe(0o700)
    expect(PROFILE_LIVE_GATEWAY_LOCATOR_MODE).toBe(0o600)
    expect(PROFILE_LIVE_GATEWAY_SOCKET_MODE).toBe(0o600)
    expect(parseProfileLiveGatewayLocator(installation, 'darwin', locator)).toEqual(locator)
  })

  it('stores only the Windows locator under the Profile root and derives a flat random pipe name', () => {
    const installation = syntheticInstallation('C:\\Users\\friend\\AppData\\Roaming\\Eido')

    const paths = resolveProfileLiveGatewayPaths(installation, 'win32', generation)
    const locator = createProfileLiveGatewayLocator(installation, 'win32', generation, token)

    expect(paths.locatorPath).toBe(path.join(
      installation.userDataRoot,
      'profiles',
      'default',
      'agent-gateway.json',
    ))
    expect(paths.endpoint).toBe(`\\\\.\\pipe\\eido-agent-${generation}`)
    expect(locator.endpoint).toBe(paths.endpoint)
    expect(parseProfileLiveGatewayLocator(installation, 'win32', locator)).toEqual(locator)
  })

  it('rejects path substitution, pipe substitution, unknown keys, and malformed credentials', () => {
    const installation = syntheticInstallation('/private/tmp/eido-live-gateway')
    const locator = createProfileLiveGatewayLocator(installation, 'darwin', generation, token)

    for (const candidate of [
      { ...locator, endpoint: '/tmp/attacker.sock' },
      { ...locator, generation: '../attacker' },
      { ...locator, token: 'short' },
      { ...locator, extra: true },
      { ...locator, version: 2 },
    ]) {
      expect(parseProfileLiveGatewayLocator(installation, 'darwin', candidate)).toBeUndefined()
    }

    const windowsInstallation = syntheticInstallation('C:\\Users\\friend\\AppData\\Roaming\\Eido')
    const windowsLocator = createProfileLiveGatewayLocator(
      windowsInstallation,
      'win32',
      generation,
      token,
    )
    expect(parseProfileLiveGatewayLocator(windowsInstallation, 'win32', {
      ...windowsLocator,
      endpoint: '\\\\.\\pipe\\attacker',
    })).toBeUndefined()
  })

  it('refuses a macOS socket path beyond the native sockaddr_un byte limit', () => {
    const installation = syntheticInstallation(`/private/tmp/${'long-segment-'.repeat(9)}`)

    expect(() => resolveProfileLiveGatewayPaths(installation, 'darwin', generation))
      .toThrow('Live Gateway Unix socket path exceeds 103 UTF-8 bytes')
  })
})

function syntheticInstallation(userDataRoot: string): ProfileInstallation {
  return Object.freeze({
    mode: 'proof',
    userDataRoot,
    databasePath: path.join(userDataRoot, 'profiles', 'default', 'eido-profile.sqlite'),
    disposable: true,
  })
}
