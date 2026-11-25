import { describe, expect, it } from 'vitest'
import { parseProviderRouteProvenance } from './providerRouteProvenance'

describe('provider route provenance', () => {
  it('parses current BYOK and managed evidence without carrying authority data', () => {
    const byok = parseProviderRouteProvenance({
      routeClass: 'byok',
      policyRevision: null,
    })
    const managed = parseProviderRouteProvenance({
      routeClass: 'managed',
      policyRevision: 'managed-openrouter-v1',
    })

    expect(byok).toEqual({ routeClass: 'byok', policyRevision: null })
    expect(managed).toEqual({
      routeClass: 'managed',
      policyRevision: 'managed-openrouter-v1',
    })
    expect(Object.isFrozen(byok)).toBe(true)
    expect(Object.isFrozen(managed)).toBe(true)
  })

  it('reads legacy hosted evidence without reinterpreting it as managed', () => {
    expect(parseProviderRouteProvenance({
      routeClass: 'hosted-free',
      policyRevision: 'hosted-free-v1',
    })).toEqual({
      routeClass: 'hosted-free',
      policyRevision: 'hosted-free-v1',
    })
    expect(parseProviderRouteProvenance({
      routeClass: 'hosted-paid',
      policyRevision: null,
    })).toEqual({
      routeClass: 'hosted-paid',
      policyRevision: null,
    })
  })

  it('rejects ambiguous authority and anything beyond content-blind evidence', () => {
    expect(parseProviderRouteProvenance({
      routeClass: 'byok',
      policyRevision: 'managed-policy-v1',
    })).toBeUndefined()
    expect(parseProviderRouteProvenance({
      routeClass: 'managed',
      policyRevision: null,
    })).toBeUndefined()
    expect(parseProviderRouteProvenance({
      routeClass: 'free',
      policyRevision: 'free-tier-v1',
    })).toBeUndefined()
    expect(parseProviderRouteProvenance({
      routeClass: 'paid',
      policyRevision: 'paid-tier-v1',
    })).toBeUndefined()
    expect(parseProviderRouteProvenance({
      routeClass: 'managed',
      policyRevision: 'managed-openrouter-v1',
      accountId: 'acct_private',
      paymentId: 'payment_private',
      credential: 'secret_private',
      prompt: 'private content',
    })).toBeUndefined()
  })
})
