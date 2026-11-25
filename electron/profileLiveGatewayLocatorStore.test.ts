import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProfileInstallation } from './profileInstallation'
import { createProfileLiveGatewayLocator } from './profileLiveGatewayLocator'
import {
  prepareProfileLiveGatewayDirectory,
  publishProfileLiveGatewayLocator,
  readProfileLiveGatewayLocator,
  removeProfileLiveGatewayLocator,
} from './profileLiveGatewayLocatorStore'

const roots: string[] = []
const generation = '0123456789abcdef0123456789abcdef'
const token = 'ab'.repeat(32)

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Profile Live Gateway locator storage', () => {
  it.runIf(process.platform === 'darwin')('publishes and reads only owner-only locator state', async () => {
    const installation = await syntheticInstallation()
    const locator = createProfileLiveGatewayLocator(
      installation,
      'darwin',
      generation,
      token,
    )

    await prepareProfileLiveGatewayDirectory(installation, 'darwin')
    await publishProfileLiveGatewayLocator(installation, 'darwin', locator)

    expect((await stat(path.dirname(installation.databasePath))).mode & 0o777).toBe(0o700)
    expect((await stat(path.join(
      path.dirname(installation.databasePath),
      'agent-gateway.json',
    ))).mode & 0o777).toBe(0o600)
    await expect(readProfileLiveGatewayLocator(installation, 'darwin')).resolves.toEqual({
      state: 'found',
      locator,
    })
  })

  it.runIf(process.platform === 'darwin')('distinguishes absence from rejected locator state', async () => {
    const installation = await syntheticInstallation()
    await expect(readProfileLiveGatewayLocator(installation, 'darwin')).resolves.toEqual({
      state: 'absent',
      reason: 'locator-not-found',
    })
    await prepareProfileLiveGatewayDirectory(installation, 'darwin')
    const locatorPath = path.join(path.dirname(installation.databasePath), 'agent-gateway.json')
    await writeFile(locatorPath, '{}', { mode: 0o600 })
    await expect(readProfileLiveGatewayLocator(installation, 'darwin')).resolves.toEqual({
      state: 'rejected',
      reason: 'locator-rejected',
    })
    await chmod(locatorPath, 0o644)
    await expect(readProfileLiveGatewayLocator(installation, 'darwin')).resolves.toEqual({
      state: 'rejected',
      reason: 'locator-rejected',
    })
  })

  it('classifies an unrepresentable macOS socket path as pre-admission endpoint absence', async () => {
    const root = `/private/tmp/${'long-profile-segment-'.repeat(8)}`
    const installation: ProfileInstallation = Object.freeze({
      mode: 'proof',
      userDataRoot: root,
      databasePath: path.join(root, 'profiles', 'default', 'eido-profile.sqlite'),
      disposable: true,
    })

    await expect(readProfileLiveGatewayLocator(installation, 'darwin')).resolves.toEqual({
      state: 'absent',
      reason: 'endpoint-not-found',
    })
  })

  it.runIf(process.platform === 'darwin')('removes only the locator generation it owns', async () => {
    const installation = await syntheticInstallation()
    const locator = createProfileLiveGatewayLocator(
      installation,
      'darwin',
      generation,
      token,
    )
    await prepareProfileLiveGatewayDirectory(installation, 'darwin')
    await publishProfileLiveGatewayLocator(installation, 'darwin', locator)

    await removeProfileLiveGatewayLocator(installation, 'darwin', 'f'.repeat(32))
    await expect(readProfileLiveGatewayLocator(installation, 'darwin'))
      .resolves.toMatchObject({ state: 'found' })
    await removeProfileLiveGatewayLocator(installation, 'darwin', generation)
    await expect(readProfileLiveGatewayLocator(installation, 'darwin')).resolves.toEqual({
      state: 'absent',
      reason: 'locator-not-found',
    })
  })
})

async function syntheticInstallation(): Promise<ProfileInstallation> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eido-live-locator-'))
  roots.push(root)
  return Object.freeze({
    mode: 'proof',
    userDataRoot: root,
    databasePath: path.join(root, 'profiles', 'default', 'eido-profile.sqlite'),
    disposable: true,
  })
}
