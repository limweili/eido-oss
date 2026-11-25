# ADR 0048: BYOK Is Preferred; Managed Fallback Requires Definitive Rejection

Status: superseded by ADR 0051 on 2026-10-27.

Historical decision. The founder removed this commercial architecture in [ADR 0051](0051-free-open-source-byok-only.md). Do not implement or operate it from this record.

Amends: [A Second Key Buys A Better Reach](0037-a-second-key-buys-a-better-reach.md),
[Hosted AI Monetizes Convenience While Basic BYOK Remains Free](0038-hosted-ai-monetizes-convenience-while-basic-byok-remains-free.md),
[Hosted AI Is a Control Plane Over Direct OpenRouter Access](0040-hosted-ai-is-a-control-plane-over-direct-openrouter-access.md),
and [Hosted AI Additional Usage Is Prepaid](0041-hosted-ai-additional-usage-is-prepaid.md)

## Context

Free Eido includes every product capability through provider credentials the
person supplies and funds. Eido Plus adds convenient, Eido-managed OpenRouter
and Linkup access funded from the account's prepaid Usage Balance. A Plus user
may still supply either personal key.

The product decision is to prefer a personal key whenever one exists and to
fall back to Eido-managed access when that key fails. A naive implementation
would retry through Eido after every error. That is unsafe: a timeout,
connection loss, partial stream, malformed response, or local cancellation
does not prove the provider rejected the first request. The provider may have
accepted and billed it. Sending the same action through Eido can then perform
the work twice and charge both the person's provider account and Eido Usage
Balance.

The providers expose different accounting evidence. OpenRouter includes cost
in completed response usage and supports its own provider-key fallback inside
one OpenRouter account. Linkup publishes fixed per-call prices and says that an
errored call consumes no Linkup credit. Neither fact makes an interrupted
client transport authoritative about work that may already have crossed the
provider boundary. Eido therefore needs one provider-independent financial
rule rather than a list of optimistic HTTP retries.

Research Mode is a harder boundary. A Linkup research submission can be costly,
runs asynchronously after acceptance, and cannot be cancelled or refunded by
stopping Eido. The founder has therefore made it BYOK-only; Eido-managed Linkup
and Usage Balance must never fund it.

## Decision

### Personal credentials are the primary route

When an eligible action has a configured personal provider credential, Eido
attempts that route first. Successful BYOK work does not reserve, debit, or
otherwise touch Eido Usage Balance.

BYOK is also operationally independent of Eido. It requires neither sign-in nor
an Eido Account, and its normal path must not check Eido's account service, Tier
policy, PostHog controls, balance, managed credential, or managed-route health
before calling the provider. This prevents an Eido outage from becoming a
provider outage for a person who brought a working key.

When the app observes that an Eido-operated service is unavailable, it shows a
simple toast explaining that condition. The toast may explain a failed managed
or account operation, but it does not interrupt successful BYOK work or cause a
service-health probe to be inserted into the BYOK path.

When no personal credential exists, an action may use Eido-managed access only
if all of its ordinary managed-access authorities hold: the account has current
Plus access, the action is supported by the managed provider route, operator
controls have not withheld it, and managed funding admission succeeds under
that provider's accounting contract.
Free never receives an Eido-funded fallback.

An action may cross from BYOK to Eido-managed access at most once. A failed
managed fallback ends the action; it never loops back to BYOK or begins another
managed attempt.

### Only a definitive pre-usage rejection permits fallback

The provider adapter must classify a failed BYOK attempt as one of:

- **definitive pre-usage rejection** — authoritative provider evidence proves
  the request was not admitted for billable work;
- **ambiguous provider outcome** — the request may have crossed the billable
  boundary, or the available evidence cannot prove that it did not.

Only the first classification permits Eido-managed fallback. Examples may
include invalid credentials, insufficient provider credit or quota, and rate
limiting, but only where that provider's documented contract proves rejection
before billable work. Status codes are not themselves domain authority. Each
provider adapter owns a narrow allowlist backed by its provider contract; an
unknown or changed response fails into the ambiguous class.

Timeouts, connection loss after transmission, provider 5xx responses, local
cancellation, response-parse failures, partial or started streams, an accepted
job or generation identifier, and every unknown failure are ambiguous. They
end the action without Eido-funded retry. This intentionally sacrifices some
availability to prevent duplicate work and double charging.

Fallback begins a new, durable Eido-managed financial operation only after the
definitive rejection is recorded. That operation must pass managed funding
admission before provider egress. Managed Linkup reserves its exact known call
price; managed OpenRouter relies on the account's cumulative upstream cap and
settles exact provider-reported cost after usage rather than guessing a maximum
hold. The BYOK attempt and managed attempt keep distinct provider identities
under one user-visible action so replay cannot reinterpret one as the other.

Safe fallback is automatic and does not interrupt the action with another
confirmation. It is never silent: the interface gives a visible notice that
the personal key was rejected and Eido-managed access was used. A durable entry
also appears in Usage Balance history under **Settings → Account**. The notice
and history remain content-blind; they name the route, provider, time, and
monetary effect, never the prompt, query, response, result, or credential.

### Research Mode never falls back

Research Mode is available only while a personal Linkup key is configured. Its
control and function are disabled without that key. A failed Research request
never uses Eido-managed Linkup, never consumes Usage Balance, and never retries
through a different financial route, including after a definitive rejection.

Web Mode remains eligible for the general rule: personal Linkup first, then
Eido-managed Linkup only after a definitive pre-usage rejection and only for a
current Plus account with available Usage Balance. OpenRouter-backed actions
follow the same rule with their respective personal and Eido-managed keys.

### Evidence and privacy boundaries

Provider-failure classification is financial authority. It requires focused
public-seam tests that prove each allowed rejection reaches exactly one managed
attempt, and that every ambiguous failure produces zero managed egress and zero
Usage Balance mutation. Response-loss and restart replay must not create a
second provider operation.

Operational records are content-blind: route, provider, opaque operation
identity, classification, and monetary effect may be recorded; prompts,
responses, search queries, results, and credentials may not be added to the
financial ledger or telemetry.

**Managed Linkup Is an Ephemeral Content Relay** separately resolves how the
centrally managed Linkup credential is
mediated: a closed, ephemeral, content-blind relay keeps the central key off a
user-controlled client while Research remains BYOK-only.

Provider sources consulted when recording this decision:

- [OpenRouter Usage Accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)
- [OpenRouter BYOK key priority and fallback](https://openrouter.ai/docs/guides/overview/auth/byok)
- [Linkup pricing and error charging](https://docs.linkup.so/pages/documentation/platform/pricing)

## Considered Options

- **Chosen: BYOK first, with managed fallback only after definitive pre-usage
  rejection.** This preserves user-funded access by default while recovering
  safely from failures that provably incurred no provider work.
- **Not chosen: fall back after every BYOK failure.** It maximizes apparent
  availability by accepting duplicate work and double-charging risk whenever
  the first outcome is ambiguous.
- **Not chosen: never fall back from BYOK.** It is financially simple but does
  not deliver the founder's intended Plus convenience when a personal key is
  definitively rejected.
- **Not chosen: Eido-managed access first whenever Plus exists.** It consumes
  Usage Balance despite a working personal key and reverses the rule that BYOK
  usage belongs entirely to the person.
- **Not chosen: allow managed Research fallback.** Research is deliberately
  excluded because of its higher, non-cancellable cost and asynchronous
  acceptance boundary.

## Consequences

- Some actions that could have succeeded on a retry will instead stop because
  their first financial outcome is ambiguous. That is the intended bias.
- Provider adapters gain an explicit, fail-closed rejection classification;
  generic transport errors never decide financial routing.
- Usage Balance accounting remains isolated from successful or ambiguous BYOK
  attempts and begins only at the durable managed-fallback operation.
- Research Mode can be less available than Web Mode by design: losing its
  personal Linkup key disables it rather than spending Eido funds.
- A safe managed fallback favors continuity over another confirmation prompt,
  but its visible notice and balance-history entry prevent invisible spending.
- Any future provider added to the shared balance must prove its own
  pre-usage-rejection contract before it may participate in fallback.
