import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveProfileInstallation } from './profileInstallation'

describe('packaged Profile installation paths', () => {
  it('pins durable authority beneath appData/Eido independently of package branding', () => {
    const appData = path.resolve('C:\\Users\\friend\\AppData\\Roaming')

    expect(resolveProfileInstallation({ appData })).toEqual({
      mode: 'product',
      userDataRoot: path.join(appData, 'Eido'),
      databasePath: path.join(appData, 'Eido', 'profiles', 'default', 'eido-profile.sqlite'),
      disposable: false,
    })
  })

  it('uses only an explicit disposable proof root when one is supplied', () => {
    const appData = path.resolve('C:\\Users\\friend\\AppData\\Roaming')
    const proofRoot = path.resolve('C:\\Temp\\eido-shell-proof')

    expect(resolveProfileInstallation({ appData, proofRoot })).toEqual({
      mode: 'proof',
      userDataRoot: proofRoot,
      databasePath: path.join(proofRoot, 'profiles', 'default', 'eido-profile.sqlite'),
      disposable: true,
    })
  })

  it('rejects relative or empty authority roots', () => {
    expect(() => resolveProfileInstallation({ appData: '' })).toThrow('appData root is invalid')
    expect(() => resolveProfileInstallation({ appData: 'relative-app-data' })).toThrow(
      'appData root is invalid',
    )
    expect(() => resolveProfileInstallation({
      appData: path.resolve('C:\\Users\\friend\\AppData\\Roaming'),
      proofRoot: 'relative-proof',
    })).toThrow('proof root is invalid')
  })
})
