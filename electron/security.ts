export function isTrustedAppUrl(value: string): boolean {
  const url = parseUrl(value)
  return Boolean(
    url &&
      url.protocol === 'eido:' &&
      url.hostname === 'app' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '',
  )
}

export function externalUrlForWindowOpen(value: string): string | null {
  const url = parseUrl(value)
  if (!url
    || (url.protocol !== 'https:' && url.protocol !== 'http:')
    || !url.hostname
    || url.username
    || url.password) return null
  return url.toString()
}

export interface RendererBridgeFrame {
  readonly url: string
}

export interface RendererBridgeWebContents {
  readonly mainFrame: RendererBridgeFrame
}

export interface RendererBridgeEvent {
  readonly sender: unknown
  readonly senderFrame: RendererBridgeFrame | null
}

export type ProfileBridgeFrame = RendererBridgeFrame
export type ProfileBridgeWebContents = RendererBridgeWebContents
export type ProfileBridgeEvent = RendererBridgeEvent

export function assertTrustedProfileBridgeRequest(
  event: ProfileBridgeEvent,
  trustedContents: ProfileBridgeWebContents,
  args: readonly unknown[],
): ProfileBridgeRequest {
  if (!isTrustedRendererBridgeRequest(event, trustedContents, args)) {
    throw new Error('Profile bridge request was denied')
  }
  return assertProfileBridgeRequest(args[0])
}

export function assertTrustedKeychainBridgeRequest(
  event: RendererBridgeEvent,
  trustedContents: RendererBridgeWebContents,
  args: readonly unknown[],
): KeychainBridgeRequest {
  if (!isTrustedRendererBridgeRequest(event, trustedContents, args)) {
    throw new Error('Keychain bridge request was denied')
  }
  return assertKeychainBridgeRequest(args[0])
}

export function assertTrustedLinkPreviewBridgeRequest(
  event: RendererBridgeEvent,
  trustedContents: RendererBridgeWebContents,
  args: readonly unknown[],
): LinkPreviewRequest {
  if (!isTrustedRendererBridgeRequest(event, trustedContents, args)) {
    throw new Error('Link preview bridge request was denied')
  }
  return assertLinkPreviewRequest(args[0])
}

export function assertTrustedAiHarnessRequest(
  event: RendererBridgeEvent,
  trustedContents: RendererBridgeWebContents,
  args: readonly unknown[],
): AiHarnessRequest {
  if (!isTrustedRendererBridgeRequest(event, trustedContents, args)) {
    throw new Error('AI harness bridge request was denied')
  }
  return assertAiHarnessRequest(args[0])
}

export function assertTrustedProfileCheckpointAck(
  event: ProfileBridgeEvent,
  trustedContents: ProfileBridgeWebContents,
  args: readonly unknown[],
): ProfileCheckpointWireAck {
  if (!isTrustedRendererBridgeRequest(event, trustedContents, args)) {
    throw new Error('Profile checkpoint acknowledgement was denied')
  }
  return assertProfileCheckpointWireAck(args[0])
}

export function assertTrustedProfileAgentBarrierAck(
  event: ProfileBridgeEvent,
  trustedContents: ProfileBridgeWebContents,
  args: readonly unknown[],
): ProfileAgentBarrierWireAck {
  if (!isTrustedRendererBridgeRequest(event, trustedContents, args)) {
    throw new Error('Profile Agent barrier acknowledgement was denied')
  }
  return assertProfileAgentBarrierWireAck(args[0])
}

function isTrustedRendererBridgeRequest(
  event: RendererBridgeEvent,
  trustedContents: RendererBridgeWebContents,
  args: readonly unknown[],
): boolean {
  return event.sender === trustedContents
    && event.senderFrame !== null
    && event.senderFrame === trustedContents.mainFrame
    && isTrustedAppUrl(event.senderFrame.url)
    && args.length === 1
}

interface PreventableEvent {
  preventDefault(): void
}

type ExternalOpener = (url: string) => unknown | Promise<unknown>

export function createWindowSecurityPolicy(openExternal: ExternalOpener) {
  return {
    preventNavigation(event: PreventableEvent): void {
      event.preventDefault()
    },
    preventWebview(event: PreventableEvent): void {
      event.preventDefault()
    },
    checkPermission(): false {
      return false
    },
    denyPermissionRequest(_webContents: unknown, _permission: string, callback: (allowed: boolean) => void): void {
      callback(false)
    },
    handleWindowOpen(details: { readonly url: string }): { readonly action: 'deny' } {
      const externalUrl = externalUrlForWindowOpen(details.url)
      if (externalUrl) {
        try {
          void Promise.resolve(openExternal(externalUrl)).catch(() => undefined)
        } catch {
          // Opening an external browser is optional; a popup is denied regardless.
        }
      }
      return { action: 'deny' }
    },
  }
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}
import {
  assertProfileAgentBarrierWireAck,
  assertProfileBridgeRequest,
  assertProfileCheckpointWireAck,
  type ProfileAgentBarrierWireAck,
  type ProfileCheckpointWireAck,
  type ProfileBridgeRequest,
} from './profileBridgeContract'
import {
  assertKeychainBridgeRequest,
  type KeychainBridgeRequest,
} from './keychainBridgeContract'
import {
  assertLinkPreviewRequest,
  type LinkPreviewRequest,
} from './linkPreviewContract'
import {
  assertAiHarnessRequest,
  type AiHarnessRequest,
} from './aiHarnessBridgeContract'
