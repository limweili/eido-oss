import { isTrustedAppUrl } from './security'

export type DesktopLaunchIntent =
  | Readonly<{ kind: 'open-application' }>
  | Readonly<{ kind: 'open-profile-link' }>

export type DesktopLaunchIntentDispatchRequest = Readonly<{
  arrival: 'cold' | 'warm'
  argv: readonly string[]
}>

export type DesktopLaunchIntentDispatchResult =
  | Readonly<{ status: 'accepted'; intent: DesktopLaunchIntent }>
  | Readonly<{ status: 'rejected' }>

export interface DesktopLaunchIntentDispatcher {
  dispatch(request: DesktopLaunchIntentDispatchRequest): DesktopLaunchIntentDispatchResult
}

const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/
const INVALID_PERCENT_ESCAPE = /%(?![0-9A-Fa-f]{2})/
const SENSITIVE_ARGUMENT_NAME = new Set([
  'accesstoken',
  'authorization',
  'bearer',
  'clientsecret',
  'code',
  'idtoken',
  'nonce',
  'oauthtoken',
  'refreshtoken',
  'state',
  'token',
])

export function createDesktopLaunchIntentDispatcher({
  activatePrimary,
}: Readonly<{
  activatePrimary: () => void
}>): DesktopLaunchIntentDispatcher {
  return Object.freeze({
    dispatch(request: DesktopLaunchIntentDispatchRequest): DesktopLaunchIntentDispatchResult {
      const intent = resolveDesktopLaunchIntent(request.argv)
      if (!intent) return Object.freeze({ status: 'rejected' })
      if (request.arrival === 'warm') activatePrimary()
      return Object.freeze({ status: 'accepted', intent })
    },
  })
}

function resolveDesktopLaunchIntent(argv: readonly string[]): DesktopLaunchIntent | null {
  if (argv.some(hasSensitiveStandaloneArgument)) return null

  const urlArguments = argv.filter((argument) => {
    const candidate = argument.trim()
    return URL_SCHEME.test(candidate) && !WINDOWS_ABSOLUTE_PATH.test(candidate)
  })
  if (urlArguments.length === 0) return Object.freeze({ kind: 'open-application' })
  if (urlArguments.length !== 1) return null

  const rawUrl = urlArguments[0]
  if (rawUrl !== rawUrl.trim() || INVALID_PERCENT_ESCAPE.test(rawUrl)) return null

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (!isTrustedAppUrl(rawUrl) || hasSensitiveUrlPayload(url)) return null

  return Object.freeze({
    kind: url.searchParams.has('idea') || url.searchParams.has('card')
      ? 'open-profile-link'
      : 'open-application',
  })
}

function hasSensitiveStandaloneArgument(argument: string): boolean {
  const trimmed = argument.trim()
  if (/^bearer\s/i.test(trimmed) || /^authorization\s*[:=]/i.test(trimmed)) return true
  const option = /^--([^=:\s]+)(?:[=:]|$)/.exec(trimmed)
  return option ? isSensitiveName(option[1]) : false
}

function hasSensitiveUrlPayload(url: URL): boolean {
  if (hasSensitiveParameters(url.searchParams)) return true
  const fragment = url.hash.slice(1)
  if (!fragment) return false
  if (/^bearer(?:\s|%20)/i.test(fragment)) return true
  return hasSensitiveParameters(new URLSearchParams(fragment))
}

function hasSensitiveParameters(parameters: URLSearchParams): boolean {
  for (const [name, value] of parameters) {
    if (isSensitiveName(name) || /^bearer\s/i.test(value.trim())) return true
  }
  return false
}

function isSensitiveName(name: string): boolean {
  return SENSITIVE_ARGUMENT_NAME.has(name.toLowerCase().replaceAll('-', '').replaceAll('_', ''))
}
