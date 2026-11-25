import type { LinkPreviewResponse } from './linkPreviewContract'
import type { LinkPreviewService } from './linkPreviewService'
import type { LocalHtmlPreviewService } from './localHtmlPreviewService'
import { webUrlFromClipboardText } from './linkPreviewUrlClassifier'
import {
  assertTrustedLinkPreviewBridgeRequest,
  type RendererBridgeEvent,
  type RendererBridgeWebContents,
} from './security'

export type InstalledLinkPreviewMainSession = Readonly<{
  route(event: RendererBridgeEvent, args: readonly unknown[]): Promise<LinkPreviewResponse>
  close(): void
}>

export function createInstalledLinkPreviewMainSession({
  service,
  localService,
  target,
}: Readonly<{
  service: LinkPreviewService
  localService: LocalHtmlPreviewService
  target: RendererBridgeWebContents
}>): InstalledLinkPreviewMainSession {
  return Object.freeze({
    async route(event, args) {
      const request = assertTrustedLinkPreviewBridgeRequest(event, target, args)
      if (request.operation === 'recognize') {
        return Object.freeze({ ok: true, url: webUrlFromClipboardText(request.payload.text) })
      }
      if (request.operation === 'recognize-local') {
        try {
          return Object.freeze({ ok: true, source: await localService.recognize(request.payload.text) })
        } catch {
          return Object.freeze({ ok: false, code: 'unavailable' })
        }
      }
      if (request.operation === 'load-local') {
        try {
          return Object.freeze({
            ok: true,
            capture: await localService.load(request.payload.sourceId, request.payload.refresh),
          })
        } catch {
          return Object.freeze({ ok: false, code: 'unavailable' })
        }
      }
      if (request.operation === 'open-local') {
        try {
          return Object.freeze({ ok: true, opened: await localService.open(request.payload.sourceId) })
        } catch {
          return Object.freeze({ ok: false, code: 'unavailable' })
        }
      }
      try {
        return Object.freeze({ ok: true, preview: await service.load(request.payload.url) })
      } catch {
        return Object.freeze({ ok: false, code: 'unavailable' })
      }
    },
    close() {
      localService.close()
    },
  })
}
