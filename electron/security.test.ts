import { describe, expect, it, vi } from 'vitest'
import {
  assertTrustedKeychainBridgeRequest,
  assertTrustedProfileCheckpointAck,
  assertTrustedProfileBridgeRequest,
  createWindowSecurityPolicy,
  externalUrlForWindowOpen,
  isTrustedAppUrl,
} from './security'
import { KEYCHAIN_BRIDGE_VERSION } from './keychainBridgeContract'
import { PROFILE_BRIDGE_VERSION } from './profileBridgeContract'

describe('Electron shell security policy', () => {
  it('trusts only the credential-free eido://app origin', () => {
    expect(isTrustedAppUrl('eido://app/')).toBe(true)
    expect(isTrustedAppUrl('eido://app/?idea=one#card')).toBe(true)

    for (const url of [
      'eido://other/',
      'eido://user@app/',
      'eido://app:443/',
      'file:///tmp/index.html',
      'https://app/',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(isTrustedAppUrl(url), url).toBe(false)
    }
  })

  it('opens only credential-free web links externally and never creates a popup', () => {
    expect(externalUrlForWindowOpen('https://example.com/docs?q=eido#shell')).toBe(
      'https://example.com/docs?q=eido#shell',
    )
    expect(externalUrlForWindowOpen('http://example.com/')).toBe('http://example.com/')

    for (const url of [
      'https://user:secret@example.com/',
      'eido://app/',
      'file:///C:/private.txt',
      'javascript:alert(1)',
      'data:text/html,attack',
      'mailto:test@example.com',
      'not a url',
    ]) {
      expect(externalUrlForWindowOpen(url), url).toBeNull()
    }
  })

  it('accepts a bounded Profile request only from the owned eido://app main frame', () => {
    const mainFrame = { url: 'eido://app/' }
    const trustedContents = { mainFrame }
    const validEvent = { sender: trustedContents, senderFrame: mainFrame }
    const validRequest = {
      version: PROFILE_BRIDGE_VERSION,
      requestId: 'renderer-request-1',
      operation: 'status',
      payload: {},
    } as const

    expect(assertTrustedProfileBridgeRequest(validEvent, trustedContents, [validRequest])).toEqual(
      validRequest,
    )

    const attacks = [
      [{ sender: {}, senderFrame: mainFrame }, [validRequest]],
      [{ sender: trustedContents, senderFrame: { url: 'eido://app/' } }, [validRequest]],
      [{ sender: trustedContents, senderFrame: { url: 'https://attacker.example/' } }, [validRequest]],
      [{ sender: trustedContents, senderFrame: null }, [validRequest]],
      [validEvent, []],
      [validEvent, [validRequest, validRequest]],
      [validEvent, [{ ...validRequest, version: 2 }]],
      [validEvent, [{ ...validRequest, trustedActor: { id: 'forged' } }]],
      [
        validEvent,
        [{
          ...validRequest,
          operation: 'create-ordinary-idea',
          payload: { ideaId: 'x'.repeat(513) },
        }],
      ],
      [
        validEvent,
        [{
          ...validRequest,
          operation: 'export-portable',
          payload: {
            request: {
              version: 1,
              operationId: 'export-1',
              expectedRevision: 0,
              destination: 'C:\\private\\profile.eido',
            },
          },
        }],
      ],
      [validEvent, [{ ...validRequest, operation: 'apply-command-batch' }]],
    ] as const

    for (const [event, args] of attacks) {
      expect(() => assertTrustedProfileBridgeRequest(event, trustedContents, [...args])).toThrow(
        'Profile bridge request was denied',
      )
    }
  })

  it('accepts checkpoint acknowledgement only from the same owned main frame', () => {
    const mainFrame = { url: 'eido://app/' }
    const trustedContents = { mainFrame }
    const event = { sender: trustedContents, senderFrame: mainFrame }
    const acknowledgement = {
      version: PROFILE_BRIDGE_VERSION,
      kind: 'checkpoint-ack',
      token: 'checkpoint-1',
      ok: true,
      generation: 2,
      nativeGeneration: 2,
      revision: 3,
    } as const

    expect(assertTrustedProfileCheckpointAck(event, trustedContents, [acknowledgement])).toEqual(
      acknowledgement,
    )
    expect(() => assertTrustedProfileCheckpointAck(
      { sender: {}, senderFrame: mainFrame },
      trustedContents,
      [acknowledgement],
    )).toThrow('Profile checkpoint acknowledgement was denied')
    expect(() => assertTrustedProfileCheckpointAck(event, trustedContents, [{
      ...acknowledgement,
      token: '',
    }])).toThrow('Profile checkpoint acknowledgement was denied')
  })

  it('applies the same owned-main-frame trust boundary to keychain requests', () => {
    const mainFrame = { url: 'eido://app/' }
    const trustedContents = { mainFrame }
    const validEvent = { sender: trustedContents, senderFrame: mainFrame }
    const request = {
      version: KEYCHAIN_BRIDGE_VERSION,
      requestId: 'keychain-request-1',
      operation: 'set',
      payload: { credential: 'openrouter', apiKey: 'sk-protected' },
    } as const

    expect(assertTrustedKeychainBridgeRequest(validEvent, trustedContents, [request])).toEqual(request)
    expect(() => assertTrustedKeychainBridgeRequest(
      { sender: {}, senderFrame: mainFrame },
      trustedContents,
      [request],
    )).toThrow('Keychain bridge request was denied')
    expect(() => assertTrustedKeychainBridgeRequest(
      validEvent,
      trustedContents,
      [{ ...request, payload: { credential: 'openrouter', apiKey: '', path: '/tmp/key' } }],
    )).toThrow('Keychain bridge request was denied')
    // The second credential crosses the same boundary, not a looser one.
    expect(assertTrustedKeychainBridgeRequest(validEvent, trustedContents, [{
      ...request,
      payload: { credential: 'linkup', apiKey: 'lk-protected' },
    }])).toBeTruthy()
    expect(() => assertTrustedKeychainBridgeRequest(
      { sender: {}, senderFrame: mainFrame },
      trustedContents,
      [{ ...request, payload: { credential: 'linkup', apiKey: 'lk-protected' } }],
    )).toThrow('Keychain bridge request was denied')
  })

  it('denies navigation, webviews, permissions, and every popup while externalizing web links', async () => {
    const openExternal = vi.fn(async () => undefined)
    const policy = createWindowSecurityPolicy(openExternal)
    const navigationEvent = { preventDefault: vi.fn() }
    const webviewEvent = { preventDefault: vi.fn() }
    const permissionDecision = vi.fn()

    policy.preventNavigation(navigationEvent)
    policy.preventWebview(webviewEvent)
    policy.denyPermissionRequest({}, 'geolocation', permissionDecision)

    expect(navigationEvent.preventDefault).toHaveBeenCalledOnce()
    expect(webviewEvent.preventDefault).toHaveBeenCalledOnce()
    expect(policy.checkPermission()).toBe(false)
    expect(permissionDecision).toHaveBeenCalledWith(false)

    for (const url of [
      'https://example.com/docs',
      'http://example.com/',
      'eido://app/second-window',
      'file:///C:/private.txt',
      'javascript:alert(1)',
    ]) {
      expect(policy.handleWindowOpen({ url })).toEqual({ action: 'deny' })
    }
    await Promise.resolve()
    expect(openExternal).toHaveBeenCalledTimes(2)
    expect(openExternal).toHaveBeenNthCalledWith(1, 'https://example.com/docs')
    expect(openExternal).toHaveBeenNthCalledWith(2, 'http://example.com/')
  })

  it('keeps popups denied when the external opener throws or rejects', async () => {
    const throwPolicy = createWindowSecurityPolicy(() => {
      throw new Error('browser unavailable')
    })
    const rejectPolicy = createWindowSecurityPolicy(async () => {
      throw new Error('browser unavailable')
    })

    expect(throwPolicy.handleWindowOpen({ url: 'https://example.com/' })).toEqual({ action: 'deny' })
    expect(rejectPolicy.handleWindowOpen({ url: 'https://example.com/' })).toEqual({ action: 'deny' })
    await Promise.resolve()
  })
})
