import type { AiExecutionPlan } from './executionPlan'
import type { CompletionStream, StreamOptions } from './openRouter'
import { ensureModelWindowsFresh } from './modelWindows'

export type AiExecutionSource = 'in-app' | 'agent-cli'
export type AiExecutionAction =
  | 'ask'
  | 'chain'
  | 'conversation'
  | 'follow-up'
  | 'group-compression'
  | 'variation'

const accessGrantMarker: unique symbol = Symbol('eido.ai-access-grant')

/** Credentials remain ephemeral and outside the inspectable run provenance. */
export type AiAccessGrant = Readonly<{
  routeClass: 'byok'
  policyRevision: null
  [accessGrantMarker]: true
}>

export type AiAccessDenial = Readonly<{
  ok: false
  explanation: 'setup'
  code: 'api-key-required'
}>
export type AiAccessDecision =
  | Readonly<{ ok: true; grant: AiAccessGrant }>
  | AiAccessDenial
export type AiAccessFailure = Readonly<{
  ok: false
  reason: 'no-key'
  message: 'errCouldNotReach'
  access: AiAccessDenial
}>

export type AiAccessRequest = Readonly<{
  action?: AiExecutionAction
  source: AiExecutionSource
  byokCredential: string
  requestedModel: string
  providerModelIds: readonly string[]
  executionPlan: AiExecutionPlan
  localCompletion?: CompletionStream
}>
export type EngineAiAccessRequest = AiAccessRequest & Readonly<{
  action: AiExecutionAction
}>

type GrantAuthority =
  | Readonly<{ kind: 'byok'; credential: string }>
  | Readonly<{ kind: 'local'; completion: CompletionStream }>

const grantAuthorities = new WeakMap<AiAccessGrant, GrantAuthority>()

/** Every execution uses the person's OpenRouter key or their local CLI. */
export function resolveAiAccess(request: AiAccessRequest): AiAccessDecision {
  if (request.localCompletion) {
    return Object.freeze({
      ok: true,
      grant: createGrant({ kind: 'local', completion: request.localCompletion }),
    })
  }
  const credential = request.byokCredential.trim()
  if (!credential) {
    return Object.freeze({ ok: false, explanation: 'setup', code: 'api-key-required' })
  }
  return Object.freeze({
    ok: true,
    grant: createGrant({ kind: 'byok', credential }),
  })
}

export async function resolveEngineAiAccess(
  request: EngineAiAccessRequest,
  _options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<AiAccessDecision> {
  const decision = resolveAiAccess(request)
  if (decision.ok && !request.localCompletion) {
    // Refresh the public model-window cache with the same user-owned key.
    // A catalog failure leaves seeded windows in place and never delays a run.
    void ensureModelWindowsFresh(request.byokCredential)
  }
  return decision
}

export function aiAccessFailure(access: AiAccessDenial): AiAccessFailure {
  return Object.freeze({ ok: false, reason: 'no-key', message: 'errCouldNotReach', access })
}

function grantAuthority(grant: AiAccessGrant): GrantAuthority {
  const authority = grantAuthorities.get(grant)
  if (!authority || grant[accessGrantMarker] !== true) {
    throw new Error('AI access grant is invalid')
  }
  return authority
}

export function assertAiAccessGrant(grant: AiAccessGrant, _requestedModel: string): void {
  grantAuthority(grant)
}

/** The only remote completion destination. Its bearer is always user supplied. */
export function fetchOpenRouterWithAccess(
  grant: AiAccessGrant,
  _requestedModel: string,
  body: string,
  extraHeaders: Readonly<Record<string, string>> = {},
  signal?: AbortSignal,
): Promise<Response> {
  const authority = grantAuthority(grant)
  if (authority.kind === 'local') {
    throw new Error('Local provider access does not use OpenRouter fetch')
  }
  return fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
      Authorization: `Bearer ${authority.credential}`,
    },
    body,
    signal,
  })
}

/** A local CLI owns its transport and tool loop. */
export function streamLocalCompletionWithAccess(
  grant: AiAccessGrant,
  instruction: string,
  options: StreamOptions,
): Promise<string> | undefined {
  const authority = grantAuthority(grant)
  return authority.kind === 'local' ? authority.completion(instruction, options) : undefined
}

function createGrant(authority: GrantAuthority): AiAccessGrant {
  const grant: AiAccessGrant = Object.freeze({
    routeClass: 'byok',
    policyRevision: null,
    [accessGrantMarker]: true as const,
  })
  grantAuthorities.set(grant, Object.freeze(authority))
  return grant
}
