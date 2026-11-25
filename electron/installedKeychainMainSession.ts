import {
  failedKeychainBridgeResponse,
  successKeychainBridgeResponse,
  type KeychainBridgeResponse,
  type KeychainCredentialName,
} from './keychainBridgeContract'
import type { LocalCredentialStore } from './localCredentialStore'
import {
  assertTrustedKeychainBridgeRequest,
  type RendererBridgeEvent,
  type RendererBridgeWebContents,
} from './security'

export type InstalledKeychainMainSession = Readonly<{
  route(
    event: RendererBridgeEvent,
    args: readonly unknown[],
  ): Promise<KeychainBridgeResponse>
}>

// One store per credential slot. The renderer names the slot on every request,
// so the main process never infers which secret it was handed.
export type KeychainCredentialStores = Readonly<
  Record<KeychainCredentialName, LocalCredentialStore>
>

export function createInstalledKeychainMainSession({
  store,
  stores,
  target,
}: Readonly<{
  // The OpenRouter store. Kept as its own parameter so every existing caller and
  // test that predates the second slot still reads exactly as it did.
  store: LocalCredentialStore
  // Every other slot, exhaustively. Required and total on purpose: a slot that
  // exists on the wire but was never wired here fails only at the moment a user
  // saves that key, which is exactly how the Linkup key came to refuse to save.
  // A missing slot is now a type error instead.
  stores: Omit<KeychainCredentialStores, 'openrouter'>
  target: RendererBridgeWebContents
}>): InstalledKeychainMainSession {
  const storeFor = (credential: KeychainCredentialName): LocalCredentialStore => {
    return credential === 'openrouter' ? store : stores[credential]
  }

  return Object.freeze({
    async route(event, args) {
      const request = assertTrustedKeychainBridgeRequest(event, target, args)
      try {
        switch (request.operation) {
          case 'get': {
            const reading = await storeFor(request.payload.credential).read()
            // An absent credential is an answer, not a failure: a Profile that
            // never held a key is the ordinary case and the renderer treats the
            // empty string as "not set". A locked one is a failure with its own
            // code, because the renderer must not be able to mistake a key it
            // cannot open for a key that was never there (#1359, #1360).
            if (reading.state === 'locked') return failedKeychainBridgeResponse(request, 'locked')
            return successKeychainBridgeResponse(
              request,
              Object.freeze({ apiKey: reading.state === 'present' ? reading.apiKey : '' }),
            )
          }
          case 'set':
            await storeFor(request.payload.credential).set(request.payload.apiKey)
            return successKeychainBridgeResponse(request, Object.freeze({ stored: true }))
          case 'clear':
            await storeFor(request.payload.credential).clear()
            return successKeychainBridgeResponse(request, Object.freeze({ cleared: true }))
          case 'migrate-legacy':
            return successKeychainBridgeResponse(
              request,
              await store.migrateLegacy(request.payload.apiKey),
            )
          default:
            return assertNever(request)
        }
      } catch {
        return failedKeychainBridgeResponse(request)
      }
    },
  })
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Keychain request: ${String(value)}`)
}
