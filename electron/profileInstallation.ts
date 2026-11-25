import path from 'node:path'

export const EIDO_PRODUCT_DIRECTORY = 'Eido' as const
export const EIDO_DEFAULT_PROFILE_RELATIVE_PATH = path.join(
  'profiles',
  'default',
  'eido-profile.sqlite',
)

export type ProfileInstallation = Readonly<{
  mode: 'product' | 'proof'
  userDataRoot: string
  databasePath: string
  disposable: boolean
}>

export function resolveProfileInstallation({
  appData,
  proofRoot,
}: Readonly<{
  appData: string
  proofRoot?: string
}>): ProfileInstallation {
  const userDataRoot = proofRoot === undefined
    ? resolveProductUserDataRoot(appData)
    : requireAbsoluteRoot(proofRoot, 'proof')

  return Object.freeze({
    mode: proofRoot === undefined ? 'product' : 'proof',
    userDataRoot,
    databasePath: path.join(userDataRoot, EIDO_DEFAULT_PROFILE_RELATIVE_PATH),
    disposable: proofRoot !== undefined,
  })
}

export function resolveProductUserDataRoot(appData: string): string {
  return path.join(requireAbsoluteRoot(appData, 'appData'), EIDO_PRODUCT_DIRECTORY)
}

function requireAbsoluteRoot(candidate: string, label: 'appData' | 'proof'): string {
  if (candidate.trim() === '' || !path.isAbsolute(candidate)) {
    throw new Error(`${label} root is invalid`)
  }
  return path.normalize(candidate)
}
