# ADR 0045: Hosted AI Separates Visible Turns From Provider Calls

Status: superseded by ADR 0051 on 2026-10-27.

Historical decision. The founder removed this commercial architecture in [ADR 0051](0051-free-open-source-byok-only.md). Do not implement or operate it from this record.

## Context

One Eido action is not necessarily one model call or one visible result. Ask
chains may heal stale steps, Conversation can produce several participant
replies, variations multiply outputs, and Group compression, context
compaction, and speaker naming consume provider funds without producing the
visible response the person asked Eido to meter. Counting button presses or
adding quota checks to individual components would drift across GUI and
delegated execution and would admit partial work unpredictably.

The direct Hosted AI bearer credential also means a modified client can bypass
Eido's turn-settlement messages. The customer-facing turn meter is enforceable
across honest concurrent installations, but only OpenRouter's credential limit
is the hard financial boundary against extraction or client tampering.

## Decision

Every AI action derives one provider-neutral execution admission plan before it
runs. The plan exposes at least:

- `visibleTurns`: the maximum user-visible replies subject to Free AI Turn or
  paid-balance admission; and
- `providerCalls`: the maximum inference calls, including hidden helpers,
  subject to model policy and financial safety.

Hosted AI atomically reserves the whole planned visible batch under a stable
idempotency key before any provider call. Each successfully finalized visible
reply settles one unit; failed, cancelled, expired, or unstarted work releases
its hold. Hidden helper calls settle provider cost but never decrement the
displayed Free AI Turn allowance. Server time and account-scoped transactions
own rolling-window availability across installations.

The same planner and admission interface serves GUI and delegated execution.
BYOK bypasses Hosted account, entitlement, turn, and credit admission entirely.
The current CLI remains BYOK-only; Hosted fallback is denied there until the
future advanced-capability entitlement is deliberately implemented.

## Considered Options

- Chosen: one shared execution plan with separate visible and provider-call
  quantities, plus batch reservation and per-result settlement.
- Not chosen: one turn per button press or OpenRouter request, because neither
  matches the visible value contract across chains and Conversations.
- Not chosen: UI-only paywall checks, because runners and delegated execution
  can enter below components and would bypass them.
- Not chosen: claiming direct-key turn enforcement is tamper-proof, because a
  user-controlled desktop can omit settlement or call OpenRouter outside Eido.

## Consequences

- Planning becomes a common dependency before Hosted Ask, Conversation,
  variations, follow-ups, and helper calls are integrated.
- Route provenance may store only `byok`, `hosted-free`, or `hosted-paid` plus
  policy revision; it never stores account, customer, subscription, or key IDs
  in Board data. This Board provenance describes how an execution was admitted;
  it is not the server-authoritative Funding Route and cannot change a
  credential generation's accounting.
- Reservation TTL, partial-output semantics, reconciliation, and the bounded
  gap between reserved and provider-accounted cost are explicit service rules.
- Product copy can promise a comprehensible visible-turn quota while operator
  controls separately reserve and cap every provider call.

## Amendment, 2026-08-25: provider-route provenance expands before cutover

The final Free + Eido Plus commercial model in #1212 supersedes the free-turn
and hosted-paid funding split above. A provider action now has one current
Funding Route: `byok` when the person funds it, or `managed` when Usage Balance
funds Eido-managed provider access. Tier names never stand in for that route.

Run provenance expands before live routes migrate. New current evidence may be
`byok` or `managed`; `hosted-free` and `hosted-paid` remain readable as exact,
distinct legacy evidence during the staged migration and are never normalized
into either current value. The later contract phase removes those legacy forms
only after proving no caller still writes them.

The phase stays content-blind and exact: it contains only `routeClass` and
`policyRevision`. BYOK carries a null Eido policy revision and managed evidence
requires a concrete policy revision. Legacy Hosted evidence preserves its
stored policy field exactly, including the previously readable null form;
compatibility never upgrades it into current authority. Account, customer,
payment, credential, prompt, query, response, and result data remain forbidden
from Board and Profile route provenance.

## Amendment, 2026-08-30: the reservation is an ordered call manifest

`providerCalls` remains the server-owned maximum used by the financial
reservation. It is now backed by the complete ordered provider-call manifest,
not by a client-reported count. Each item names its call class and provider
model; only `context-compaction` and `speaker-name` may be optional. The control
plane derives and returns the bounded request authority for each item after its
final money and provider rereads. Electron consumes that authority in order and
settlement records every started provider generation at its manifest index.

This makes the reservation formula and the evidence that discharges it the
same durable object. An exact retry must carry the same manifest. A required
gap, a different model, or a generation attached to the wrong index cannot be
reinterpreted as cheaper work.
