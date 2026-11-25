import { describe, expect, it } from 'vitest'
import { resolveCardIdentity } from '../../ui/cardIdentity'
import { cardBodyForegroundVariables } from './cardIdentityStyle'

describe('card identity style adapter', () => {
  it('owns the live functional-variable mapping in one adapter', () => {
    const identity = resolveCardIdentity('#777777')

    expect(cardBodyForegroundVariables(identity, 'all')).toEqual({
      '--identity-body-ink': identity.bodyForegrounds.ink,
      '--identity-body-ink-soft': identity.bodyForegrounds.inkSoft,
      '--identity-body-ink-faint': identity.bodyForegrounds.inkFaint,
      '--identity-body-go-ink': identity.bodyForegrounds.goInk,
      '--identity-body-avoid-ink': identity.bodyForegrounds.avoidInk,
      '--identity-body-mod-ink': identity.bodyForegrounds.modInk,
      '--identity-body-convo-ink': identity.bodyForegrounds.convoInk,
      '--identity-body-attention-ink': identity.bodyForegrounds.attentionInk,
    })
  })

  it('gives Playback only the neutral variables it renders', () => {
    const identity = resolveCardIdentity('#777777')

    expect(cardBodyForegroundVariables(identity, 'neutral')).toEqual({
      '--identity-body-ink': identity.bodyForegrounds.ink,
      '--identity-body-ink-soft': identity.bodyForegrounds.inkSoft,
      '--identity-body-ink-faint': identity.bodyForegrounds.inkFaint,
    })
  })
})
