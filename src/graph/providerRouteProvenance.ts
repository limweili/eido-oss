type LegacyHostedRouteClass = 'hosted-free' | 'hosted-paid'

export type ProviderRouteProvenance =
  | Readonly<{ routeClass: 'byok'; policyRevision: null }>
  | Readonly<{ routeClass: 'managed'; policyRevision: string }>
  | Readonly<{ routeClass: LegacyHostedRouteClass; policyRevision: string | null }>

const POLICY_REVISION = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/

/**
 * Reads saved run provenance. New runs use BYOK. Retired route names and their
 * policy revisions are preserved so existing Boards and exports round-trip.
 */
export function parseProviderRouteProvenance(
  value: unknown,
): ProviderRouteProvenance | undefined {
  if (!isPlainRecord(value)) return undefined
  const keys = Object.keys(value)
  if (keys.length !== 2 || !keys.includes('routeClass') || !keys.includes('policyRevision')) {
    return undefined
  }

  if (value.routeClass === 'byok') {
    return value.policyRevision === null
      ? Object.freeze({ routeClass: 'byok', policyRevision: null })
      : undefined
  }
  if (value.routeClass === 'hosted-free' || value.routeClass === 'hosted-paid') {
    if (value.policyRevision === null) {
      return Object.freeze({ routeClass: value.routeClass, policyRevision: null })
    }
    if (typeof value.policyRevision !== 'string'
      || !POLICY_REVISION.test(value.policyRevision)) {
      return undefined
    }
    return Object.freeze({
      routeClass: value.routeClass,
      policyRevision: value.policyRevision,
    })
  }
  if (value.routeClass !== 'managed'
    || typeof value.policyRevision !== 'string'
    || !POLICY_REVISION.test(value.policyRevision)) {
    return undefined
  }
  return Object.freeze({
    routeClass: 'managed',
    policyRevision: value.policyRevision,
  })
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}
