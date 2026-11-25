import type { LocalCredentialStore } from './localCredentialStore'
import type { ProfileAuxiliaryLaunch } from './profileAuxiliaryLaunch'
import {
  resolveProductUserDataRoot,
  type ProfileInstallation,
} from './profileInstallation'

export type ProfileCredentialInstallation = Readonly<{
  access: 'mutable' | 'read-only'
  userDataRoot: string
}>

export function resolveProfileCredentialInstallation({
  appData,
  profileInstallation,
  launch,
}: Readonly<{
  appData: string
  profileInstallation: ProfileInstallation
  launch: ProfileAuxiliaryLaunch
}>): ProfileCredentialInstallation {
  if (launch.kind !== 'review') {
    return Object.freeze({
      access: 'mutable',
      userDataRoot: profileInstallation.userDataRoot,
    })
  }
  if (profileInstallation.mode !== 'proof' || !profileInstallation.disposable) {
    throw new Error('Development Profile review requires a disposable explicit root')
  }
  return Object.freeze({
    access: 'read-only',
    userDataRoot: resolveProductUserDataRoot(appData),
  })
}

export function createReadOnlyCredentialStore(
  backingStore: LocalCredentialStore,
): LocalCredentialStore {
  const denyMutation = async (): Promise<never> => {
    throw new Error('Local credential storage is unavailable')
  }
  return Object.freeze({
    // Reading now has a write in it: a credential from the generation before
    // #1359 is rewritten as protected on the way past. That write is refused
    // here, or a development review pointed at the real product Profile would
    // silently rewrite the founder's credential files. The review still gets
    // the key; the migration waits for an ordinary launch.
    read: () => backingStore.read({ migrate: false }),
    set: denyMutation,
    clear: denyMutation,
    migrateLegacy: denyMutation,
  })
}
