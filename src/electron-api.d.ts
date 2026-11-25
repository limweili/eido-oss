import type { InstalledProfileBridge } from '../electron/profileBridgeContract'
import type { InstalledKeychainBridge } from '../electron/keychainBridgeContract'
import type { InstalledLinkPreviewBridge } from '../electron/linkPreviewContract'
import type { InstalledAiHarnessBridge } from '../electron/aiHarnessBridgeContract'

declare global {
  interface Window {
    readonly eidoDesktop?: true
    readonly eidoProfileReview?: true
    readonly eidoProfile?: InstalledProfileBridge
    readonly eidoKeychain?: InstalledKeychainBridge
    readonly eidoAiHarness?: InstalledAiHarnessBridge
    readonly eidoLinkPreviews?: InstalledLinkPreviewBridge
  }
}

export {}
