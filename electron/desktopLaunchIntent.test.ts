import { describe, expect, it, vi } from 'vitest'
import { createDesktopLaunchIntentDispatcher } from './desktopLaunchIntent'

describe('desktop launch-intent dispatcher', () => {
  it('keeps ordinary cold and warm app activation behavior', () => {
    const activatePrimary = vi.fn()
    const dispatcher = createDesktopLaunchIntentDispatcher({ activatePrimary })

    expect(dispatcher.dispatch({
      arrival: 'cold',
      argv: ['/Applications/Eido.app/Contents/MacOS/Eido'],
    })).toEqual({
      status: 'accepted',
      intent: { kind: 'open-application' },
    })
    expect(activatePrimary).not.toHaveBeenCalled()

    expect(dispatcher.dispatch({
      arrival: 'warm',
      argv: ['C:\\Program Files\\Eido\\Eido.exe'],
    })).toEqual({
      status: 'accepted',
      intent: { kind: 'open-application' },
    })
    expect(activatePrimary).toHaveBeenCalledOnce()
  })

  it('preserves internal eido and Profile deep links without forwarding their payload', () => {
    const activatePrimary = vi.fn()
    const dispatcher = createDesktopLaunchIntentDispatcher({ activatePrimary })

    expect(dispatcher.dispatch({
      arrival: 'warm',
      argv: [
        '/Applications/Eido.app/Contents/MacOS/Eido',
        'eido://app/?idea=idea-main&card=card-anchor&x=8&y=9&zoom=1.2#card',
      ],
    })).toEqual({
      status: 'accepted',
      intent: { kind: 'open-profile-link' },
    })
    expect(activatePrimary).toHaveBeenCalledOnce()

    expect(dispatcher.dispatch({
      arrival: 'cold',
      argv: ['/Applications/Eido.app/Contents/MacOS/Eido', 'eido://app/'],
    })).toEqual({
      status: 'accepted',
      intent: { kind: 'open-application' },
    })
    expect(activatePrimary).toHaveBeenCalledOnce()
  })

  it('leaves existing Profile proof and review argv available to their established planners', () => {
    const dispatcher = createDesktopLaunchIntentDispatcher({ activatePrimary: vi.fn() })

    expect(dispatcher.dispatch({
      arrival: 'cold',
      argv: [
        '/Applications/Eido.app/Contents/MacOS/Eido',
        '--eido-profile-proof-root=/tmp/eido-profile-proof-one',
        '--eido-profile-proof-phase=stamp',
      ],
    })).toEqual({
      status: 'accepted',
      intent: { kind: 'open-application' },
    })
  })

  it('rejects unknown, malformed, ambiguous, or credential-bearing external intents', () => {
    const attacks = [
      ['eido', 'https://attacker.example/callback'],
      ['eido', 'eido-auth://callback?code=opaque'],
      ['eido', 'eido://other/?idea=idea-main&card=card-main'],
      ['eido', 'eido://user:password@app/'],
      ['eido', ' eido://app/'],
      ['eido', 'https://%'],
      ['eido', 'eido://app/?access_token=opaque'],
      ['eido', 'eido://app/#id_token=opaque'],
      ['eido', '--refresh-token=opaque'],
      ['eido', 'Authorization: Bearer opaque'],
      ['eido', 'eido://app/', 'eido://app/?idea=idea-main&card=card-main'],
    ] as const

    for (const argv of attacks) {
      const activatePrimary = vi.fn()
      const dispatcher = createDesktopLaunchIntentDispatcher({ activatePrimary })

      expect(dispatcher.dispatch({ arrival: 'warm', argv })).toEqual({ status: 'rejected' })
      expect(activatePrimary).not.toHaveBeenCalled()
    }
  })

  it('keeps replayed external intents rejected without retaining them', () => {
    const activatePrimary = vi.fn()
    const dispatcher = createDesktopLaunchIntentDispatcher({ activatePrimary })
    const request = {
      arrival: 'warm' as const,
      argv: ['eido', 'eido-auth://callback?code=opaque'],
    }

    expect(dispatcher.dispatch(request)).toEqual({ status: 'rejected' })
    expect(dispatcher.dispatch(request)).toEqual({ status: 'rejected' })
    expect(activatePrimary).not.toHaveBeenCalled()
  })
})
