import type { ResolvedCardIdentity } from '../../ui/cardIdentity'

export type NeutralCardBodyForegroundVariables = {
  '--identity-body-ink': string
  '--identity-body-ink-soft': string
  '--identity-body-ink-faint': string
}

export type FunctionalCardBodyForegroundVariables = {
  '--identity-body-go-ink': string
  '--identity-body-avoid-ink': string
  '--identity-body-mod-ink': string
  '--identity-body-convo-ink': string
  '--identity-body-attention-ink': string
}

export type CardBodyForegroundVariables = NeutralCardBodyForegroundVariables
  & FunctionalCardBodyForegroundVariables

export function cardBodyForegroundVariables(
  identity: ResolvedCardIdentity,
  scope: 'neutral',
): NeutralCardBodyForegroundVariables
export function cardBodyForegroundVariables(
  identity: ResolvedCardIdentity,
  scope: 'all',
): CardBodyForegroundVariables
export function cardBodyForegroundVariables(
  identity: ResolvedCardIdentity,
  scope: 'neutral' | 'all',
): NeutralCardBodyForegroundVariables | CardBodyForegroundVariables {
  const neutral: NeutralCardBodyForegroundVariables = {
    '--identity-body-ink': identity.bodyForegrounds.ink,
    '--identity-body-ink-soft': identity.bodyForegrounds.inkSoft,
    '--identity-body-ink-faint': identity.bodyForegrounds.inkFaint,
  }
  if (scope === 'neutral') return neutral

  return {
    ...neutral,
    '--identity-body-go-ink': identity.bodyForegrounds.goInk,
    '--identity-body-avoid-ink': identity.bodyForegrounds.avoidInk,
    '--identity-body-mod-ink': identity.bodyForegrounds.modInk,
    '--identity-body-convo-ink': identity.bodyForegrounds.convoInk,
    '--identity-body-attention-ink': identity.bodyForegrounds.attentionInk,
  }
}
