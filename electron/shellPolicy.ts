export const EIDO_APP_URL = 'eido://app/'

interface SchemeRegistration {
  readonly scheme: 'eido'
  readonly privileges: {
    readonly standard: true
    readonly secure: true
    readonly supportFetchAPI: true
    readonly corsEnabled: false
    readonly allowServiceWorkers: false
    readonly bypassCSP: false
  }
}

export function registerEidoScheme(register: (schemes: SchemeRegistration[]) => void): void {
  register([
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
}

export function createSecureWebPreferences(preload: string) {
  return {
    preload,
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
  } as const
}
