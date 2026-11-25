import { describe, expect, it, vi } from 'vitest'
import { createSecureWebPreferences, registerEidoScheme } from './shellPolicy'

describe('Electron shell policy', () => {
  it('registers eido as a standard secure scheme before the app becomes ready', () => {
    const registerSchemesAsPrivileged = vi.fn()

    registerEidoScheme(registerSchemesAsPrivileged)

    expect(registerSchemesAsPrivileged).toHaveBeenCalledOnce()
    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: 'eido',
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: false,
          allowServiceWorkers: false,
          bypassCSP: false,
        },
      },
    ])
  })

  it('constructs an isolated, sandboxed renderer with no Node or webview capabilities', () => {
    expect(createSecureWebPreferences('C:\\app\\preload.cjs')).toEqual({
      preload: 'C:\\app\\preload.cjs',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      enableWebSQL: false,
      safeDialogs: true,
      navigateOnDragDrop: false,
    })
  })
})
