import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

const OPENROUTER_ORIGIN = 'https://openrouter.ai'
const LINKUP_ORIGIN = 'https://api.linkup.so'
export const EIDO_CONNECT_SRC = `'self' ${OPENROUTER_ORIGIN} ${LINKUP_ORIGIN}`

export function isEidoProviderRequest(rawUrl: string, method: string): boolean {
  if (!URL.canParse(rawUrl)) return false
  const url = new URL(rawUrl)
  if (url.username || url.password) return false

  let operation: 'GET' | 'POST' | undefined
  if (url.origin === OPENROUTER_ORIGIN) {
    if (url.pathname === '/api/v1/chat/completions') operation = 'POST'
    if (url.pathname === '/api/v1/models') operation = 'GET'
  } else if (url.origin === LINKUP_ORIGIN) {
    if (['/v1/search', '/v1/fetch', '/v1/research'].includes(url.pathname)) operation = 'POST'
    if (/^\/v1\/research\/[^/]+$/.test(url.pathname)) operation = 'GET'
  }
  return operation !== undefined && (method === operation || method === 'OPTIONS')
}

export const EIDO_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${EIDO_CONNECT_SRC}`,
].join('; ')

const SECURITY_HEADERS = {
  'content-security-policy': EIDO_CONTENT_SECURITY_POLICY,
  'x-content-type-options': 'nosniff',
}

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

const ENCODED_SEPARATOR = /%(?:2f|5c)/i

function rejected(status = 404, headers: Record<string, string> = {}): Response {
  return new Response(status === 405 ? 'Method not allowed' : 'Not found', {
    status,
    headers: { ...SECURITY_HEADERS, ...headers },
  })
}

export interface EidoProtocolDependencies {
  readonly canonicalize?: (candidate: string) => Promise<string>
}

export function createEidoProtocolHandler(
  rendererRoot: string,
  dependencies: EidoProtocolDependencies = {},
) {
  const absoluteRendererRoot = path.resolve(rendererRoot)
  const canonicalize = dependencies.canonicalize ?? realpath

  return async (request: Request): Promise<Response> => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return rejected()
    }
    if (url.protocol !== 'eido:' || url.host !== 'app' || url.username || url.password) {
      return rejected()
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      return rejected(405, { allow: 'GET, HEAD' })
    }
    if (ENCODED_SEPARATOR.test(url.pathname) || url.pathname.includes('\\')) {
      return rejected()
    }

    let decodedPathname: string
    try {
      decodedPathname = decodeURIComponent(url.pathname)
    } catch {
      return rejected()
    }
    if (decodedPathname.includes('\0') || decodedPathname.includes('\\')) {
      return rejected()
    }

    const pathSegments = decodedPathname.split('/')
    if (pathSegments.some((segment) => segment === '.' || segment === '..')) {
      return rejected()
    }

    const relativePath = decodedPathname === '/' ? 'index.html' : decodedPathname.slice(1)
    const assetPath = path.resolve(absoluteRendererRoot, relativePath)
    const lexicalRelativeToRoot = path.relative(absoluteRendererRoot, assetPath)
    if (lexicalRelativeToRoot.startsWith('..') || path.isAbsolute(lexicalRelativeToRoot)) {
      return rejected()
    }

    try {
      const canonicalRendererRoot = await canonicalize(absoluteRendererRoot)
      const canonicalAssetPath = await canonicalize(assetPath)
      const canonicalRelativeToRoot = path.relative(canonicalRendererRoot, canonicalAssetPath)
      if (canonicalRelativeToRoot.startsWith('..') || path.isAbsolute(canonicalRelativeToRoot)) {
        return rejected()
      }

      const asset = await readFile(canonicalAssetPath)
      const headers = {
        ...SECURITY_HEADERS,
        'content-type':
          CONTENT_TYPES[path.extname(canonicalAssetPath).toLowerCase()] ?? 'application/octet-stream',
      }
      return new Response(request.method === 'HEAD' ? null : asset, { status: 200, headers })
    } catch {
      return rejected()
    }
  }
}
