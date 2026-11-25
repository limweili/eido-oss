import type {
  DesktopLaunchIntentDispatchRequest,
  DesktopLaunchIntentDispatchResult,
} from './desktopLaunchIntent'

export type InstalledProfileSingleInstanceAdmission = 'primary' | 'busy' | 'rejected'

export function acquireInstalledProfileSingleInstance({
  initialArgv,
  dispatchLaunchIntent,
  prepareLockIdentity,
  requestLock,
  onSecondInstance,
}: Readonly<{
  initialArgv: readonly string[]
  dispatchLaunchIntent: (
    request: DesktopLaunchIntentDispatchRequest,
  ) => DesktopLaunchIntentDispatchResult
  prepareLockIdentity: () => void
  requestLock: () => boolean
  onSecondInstance: (listener: (argv: readonly string[]) => void) => void
}>): InstalledProfileSingleInstanceAdmission {
  if (dispatchLaunchIntent({ arrival: 'cold', argv: initialArgv }).status === 'rejected') {
    return 'rejected'
  }
  prepareLockIdentity()
  if (!requestLock()) return 'busy'
  onSecondInstance((argv) => {
    dispatchLaunchIntent({ arrival: 'warm', argv })
  })
  return 'primary'
}
