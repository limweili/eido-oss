import { parse as parseDomain } from 'tldts'
import { webUrlFromClipboardText as classifyClipboardText } from '../src/shared/linkPreview'

export function webUrlFromClipboardText(value: string): string | null {
  return classifyClipboardText(value, hasRegistrableDomain)
}

function hasRegistrableDomain(hostname: string): boolean {
  const parsed = parseDomain(hostname, {
    allowPrivateDomains: false,
    detectIp: false,
    extractHostname: false,
    validateHostname: false,
  })
  return parsed.isIcann === true && parsed.domain !== null
}
