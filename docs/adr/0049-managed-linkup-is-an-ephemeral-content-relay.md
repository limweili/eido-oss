# ADR 0049: Managed Linkup Is an Ephemeral Content Relay

Status: superseded by ADR 0051 on 2026-10-27.

Historical decision. The founder removed this commercial architecture in [ADR 0051](0051-free-open-source-byok-only.md). Do not implement or operate it from this record.

Amends: [A Second Key Buys A Better Reach](0037-a-second-key-buys-a-better-reach.md) and
[Hosted AI Is a Control Plane Over Direct OpenRouter Access](0040-hosted-ai-is-a-control-plane-over-direct-openrouter-access.md)

Related: [BYOK Is Preferred; Managed Fallback Requires Definitive Rejection](0048-byok-is-preferred-managed-fallback-requires-definitive-rejection.md)

Delivery note (2026-08-26): this decision stands as the design managed Linkup
will be built to. **None of the relay or metering below is running.** Managed
Linkup was closed in epic #1212 on a certified unavailable branch, and a reader
should not take the present tense in this document as a description of shipped
behaviour.

What exists is one launch seam whose only input is a reach mode, `web` or
`research`, and which always answers `status: 'unavailable'`, `launch:
'disabled'`, `managedAttemptCount: 0`, `historyMarker: null`. There is no
relay, no provider egress, no reservation, no debit, and no history row. A
request carrying anything beyond the reach mode is refused, so a query has no
parameter to travel in.

The reason is a missing provider contract, not missing Eido work. Linkup's
published API supplies none of the five things exact settlement requires:

- `caller-bound-operation-identity`
- `idempotent-submission`
- `canonical-outcome-readback`
- `canonical-cost-readback`
- `ambiguous-response-reconciliation`

Its balance endpoint is aggregate, so concurrent calls cannot be attributed.
Building the metering described under "Metering is durable; content is not"
today would mean inventing a provider contract that does not exist, and this
ADR's own rule that an ambiguous outcome is "never guessed from transport
failure alone" is exactly what forbids it. Closed on that basis by
[#1239](https://github.com/limweili/eido/issues/1239); live settlement is
tracked in [#1291](https://github.com/limweili/eido/issues/1291).

Two parts of this decision are in force today rather than deferred:

- **Research Mode is Linkup-BYOK-only** and is refused at the managed seam by
  its own reason, `personal-linkup-key-required`, rather than by the launch
  gate. Turning managed Linkup on later would not quietly make Research
  managed.
- **The central credential is server-side and unused.** Nothing serves it to a
  desktop, and with no relay there is no content to log, cache, or retain.

Ordinary Web Mode is unaffected. It runs through OpenRouter-supported web
search, which never depended on Linkup.

## Context

Eido Plus provides managed Linkup for Web Mode through one centrally managed
provider credential. Shipping that credential inside the desktop would make it
extractable from a user-controlled machine and would collapse every account
onto an unbounded shared secret. Unlike Eido's per-user OpenRouter credential,
Linkup does not supply the product with a safe per-user credential-provisioning
boundary.

Keeping the central key secret means the managed Web Mode request has to cross
an Eido-owned service. That is a real privacy and architecture change. **Hosted
AI Is a Control Plane Over Direct OpenRouter Access** keeps AI prompts and
responses out of Eido's infrastructure by sending them
directly from the desktop to OpenRouter. A managed Linkup relay makes Eido a
data-plane dependency for the web query and Linkup result, even though it does
not make Eido an AI inference relay.

The founder accepts that boundary for Plus Web Mode on the condition that the
relay is transient and content is neither logged nor retained. Research Mode
remains BYOK-only under **BYOK Is Preferred; Managed Fallback Requires
Definitive Rejection** and never crosses this relay.

## Decision

### The central key stays server-side

Eido's managed Linkup credential exists only in the Eido service environment.
It is never returned to the desktop, included in a snapshot, written to a
Profile, placed in telemetry, or exposed through a general-purpose proxy.

The relay accepts only the closed Web Mode operations Eido supports. It
authenticates the Eido Account, verifies current Plus access and operator
posture, reserves sufficient Usage Balance, constructs the provider request,
and calls Linkup with the central credential. It is not an arbitrary URL,
header, body, or endpoint forwarder.

Personal Linkup access remains direct BYOK. A personal key is attempted first,
and the managed relay is reached only when no personal key exists or **BYOK Is
Preferred; Managed Fallback Requires Definitive Rejection** permits fallback
after a Definitive Pre-Usage Rejection.

### Content is transient

The relay may hold the minimum query, provider parameters, response, and error
material required to complete one Web Mode call in process memory for that
call's bounded lifetime. It does not persist or cache that content.

Prompts, queries, fetched text, sources, structured results, and provider
responses are forbidden from application logs, traces, analytics, financial
ledger rows, durable work payloads, retry queues, dead-letter records, and
operator diagnostics. Infrastructure error reporting must use content-blind
codes and opaque operation identifiers. Process memory is released when the
bounded call completes or fails.

Linkup still receives and processes the query under Linkup's own terms. Eido's
privacy statement and Plus purchase flow must disclose that managed Web Mode
passes query content through Eido's service to Linkup, while AI prompts and
responses continue to travel directly between the desktop and OpenRouter.

### Metering is durable; content is not

Before provider egress, Eido creates a durable, account-bound reservation for
the request's known price using an opaque operation identity. After an
authoritative Linkup outcome, Eido records only the content-blind facts needed
for exact accounting: provider, supported operation class, pricing-policy
revision, measured cost, status, and opaque provider/operation correlation
where available.

Every Linkup call is accounted for separately behind the service boundary. A
provider-confirmed billable call consumes shared Usage Balance at exact provider
cost with no Eido markup, including when Eido later cannot use the returned
result. A provider outcome that authoritatively incurs no cost releases the
reservation. An ambiguous provider outcome remains a financial reconciliation
problem and is never guessed from transport failure alone.

The Account surface does not expose per-search estimates or a provider pricing
screen. It groups all managed Linkup calls belonging to one user Run into one
content-blind **Web** history row showing their exact total monetary effect and
resulting balance. Per-call evidence remains durable for reconciliation without
storing any query or result content.

### Research and OpenRouter remain outside this relay

Research Mode is never accepted by the managed Linkup relay. It requires the
person's Linkup key, is disabled without that key, and never consumes Usage
Balance.

OpenRouter AI prompts and responses remain on the direct desktop-to-OpenRouter
path through the account's personal or Eido-provisioned per-user credential.
This ADR does not authorize an Eido AI proxy or gateway.

This difference is deliberate. OpenRouter's Management API supplies constrained
per-user child credentials, so one Eido account and credit pool do not require a
shared inference key or prompt relay. Linkup has no equivalent approved
per-user provisioning seam for this product, so its central credential remains
server-side behind the closed relay and is never served to a desktop.

## Considered Options

- **Chosen: a closed, ephemeral Eido relay for managed Linkup Web Mode.** It
  keeps the central credential secret while tightly bounding content handling.
- **Not chosen: ship the central Linkup key to the desktop.** A user-controlled
  machine cannot protect a shared credential, meter accounts authoritatively,
  or prevent use outside Eido.
- **Not chosen: store or cache queries and results in the control plane.** It
  would turn a narrow provider bridge into a content system without a product
  need or user authorization.
- **Not chosen: relay personal Linkup traffic.** BYOK is user-funded and stays
  direct; Eido mediation is justified only by the centrally managed key.
- **Not chosen: relay Research Mode.** Its higher, asynchronous,
  non-cancellable cost is deliberately BYOK-only.

## Consequences

- Eido becomes a data-plane processor for managed Linkup Web Mode content and
  must describe that fact accurately in privacy and purchase disclosures.
- Managed Web Mode depends on the availability and bounded latency of Eido's
  relay as well as Linkup. Personal Linkup remains independent of that relay.
- Logging, tracing, queue, and incident-response defaults require explicit
  content-exclusion tests; ordinary infrastructure capture is not assumed safe.
- Financial reconciliation can survive restart because monetary facts are
  durable, while the query and result remain deliberately unrecoverable from
  Eido's service after the call.
- Adding another centrally managed content provider requires a new decision;
  this relay is not a generic precedent or extension point.
