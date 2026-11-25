import type { ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'
import { createLinkPreviewService, type LinkPreviewService } from '../../electron/linkPreviewService'
import { webUrlFromClipboardText } from '../../electron/linkPreviewUrlClassifier'
import { LINK_PREVIEW_LIMITS, mightBeSchemeLessWebUrl } from '../../src/shared/linkPreview'

const LINK_PREVIEW_ROUTE = '/api/eido/link-preview'
const LINK_PREVIEW_URL_ROUTE = '/api/eido/link-preview-url'

type RouteResult = Readonly<{
  status: number
  body: Record<string, unknown>
}>

export function eidoLinkPreviewPlugin(): Plugin {
  const service = createLinkPreviewService()
  const install = (middlewares: Connect.Server) => {
    middlewares.use(async (request, response, next) => {
      const url = new URL(request.url ?? '/', 'http://eido.local')
      try {
        const result = await routeLinkPreviewRequest(request.method, url, service)
        if (!result) {
          next()
          return
        }
        sendJson(response, result.status, result.body)
      } catch {
        sendJson(response, 500, { error: 'Preview unavailable' })
      }
    })
  }
  return {
    name: 'eido-link-preview',
    configureServer(server) {
      install(server.middlewares)
    },
    configurePreviewServer(server) {
      install(server.middlewares)
    },
  }
}

export async function routeLinkPreviewRequest(
  method: string | undefined,
  url: URL,
  service: LinkPreviewService,
): Promise<RouteResult | null> {
  if (url.pathname !== LINK_PREVIEW_ROUTE && url.pathname !== LINK_PREVIEW_URL_ROUTE) return null
  if (method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } }
  if (url.pathname === LINK_PREVIEW_URL_ROUTE) {
    const text = url.searchParams.get('text')
    if (!text || text.length > LINK_PREVIEW_LIMITS.url || !mightBeSchemeLessWebUrl(text)) {
      return { status: 400, body: { error: 'Text is required' } }
    }
    return { status: 200, body: { url: webUrlFromClipboardText(text) } }
  }
  const requestedUrl = url.searchParams.get('url')
  if (!requestedUrl) return { status: 400, body: { error: 'URL is required' } }
  if (webUrlFromClipboardText(requestedUrl) !== requestedUrl) {
    return { status: 400, body: { error: 'URL is invalid' } }
  }
  return { status: 200, body: { preview: await service.load(requestedUrl) } }
}

function sendJson(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}
