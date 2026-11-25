import { describe, expect, it, vi } from 'vitest'
import type { DesktopLaunchIntentDispatchRequest } from './desktopLaunchIntent'
import { acquireInstalledProfileSingleInstance } from './installedProfileSingleInstance'

describe('installed Profile single-instance admission', () => {
  it('returns busy without registering primary work when the lock is unavailable', () => {
    const dispatchLaunchIntent = vi.fn((_request: DesktopLaunchIntentDispatchRequest) => ({
      status: 'accepted' as const,
      intent: { kind: 'open-application' as const },
    }))
    const prepareLockIdentity = vi.fn()
    const onSecondInstance = vi.fn()

    expect(acquireInstalledProfileSingleInstance({
      initialArgv: ['eido'],
      dispatchLaunchIntent,
      prepareLockIdentity,
      requestLock: () => false,
      onSecondInstance,
    })).toBe('busy')
    expect(dispatchLaunchIntent).toHaveBeenCalledWith({ arrival: 'cold', argv: ['eido'] })
    expect(prepareLockIdentity).toHaveBeenCalledOnce()
    expect(onSecondInstance).not.toHaveBeenCalled()
  })

  it('routes cold and warm arguments through one dispatcher after acquiring the primary lock', () => {
    const order: string[] = []
    let secondary: ((argv: readonly string[]) => void) | undefined
    const dispatchLaunchIntent = vi.fn((request: DesktopLaunchIntentDispatchRequest) => {
      order.push(`dispatch-${request.arrival}`)
      return {
        status: 'accepted' as const,
        intent: { kind: 'open-application' as const },
      }
    })

    expect(acquireInstalledProfileSingleInstance({
      initialArgv: ['eido'],
      dispatchLaunchIntent,
      prepareLockIdentity() {
        order.push('ensure-root-and-pin-user-data')
      },
      requestLock() {
        order.push('request-lock')
        return true
      },
      onSecondInstance(listener) {
        order.push('register-primary-listener')
        secondary = listener
      },
    })).toBe('primary')
    expect(order).toEqual([
      'dispatch-cold',
      'ensure-root-and-pin-user-data',
      'request-lock',
      'register-primary-listener',
    ])

    secondary?.(['eido', 'eido://app/?idea=idea-main&card=card-main'])
    expect(dispatchLaunchIntent).toHaveBeenLastCalledWith({
      arrival: 'warm',
      argv: ['eido', 'eido://app/?idea=idea-main&card=card-main'],
    })
    expect(order.at(-1)).toBe('dispatch-warm')
  })

  it('rejects a cold external intent before touching Profile installation or the singleton', () => {
    const prepareLockIdentity = vi.fn()
    const requestLock = vi.fn(() => true)
    const onSecondInstance = vi.fn()

    expect(acquireInstalledProfileSingleInstance({
      initialArgv: ['eido', 'eido-auth://callback?code=opaque'],
      dispatchLaunchIntent: () => ({ status: 'rejected' }),
      prepareLockIdentity,
      requestLock,
      onSecondInstance,
    })).toBe('rejected')
    expect(prepareLockIdentity).not.toHaveBeenCalled()
    expect(requestLock).not.toHaveBeenCalled()
    expect(onSecondInstance).not.toHaveBeenCalled()
  })
})
