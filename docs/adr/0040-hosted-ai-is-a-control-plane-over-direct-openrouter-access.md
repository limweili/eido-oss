# ADR 0040: Hosted AI Is a Control Plane Over Direct OpenRouter Access

Status: superseded by ADR 0051 on 2026-10-27.

Historical decision. The founder removed this commercial architecture in [ADR 0051](0051-free-open-source-byok-only.md). Do not implement or operate it from this record.

## Context

Eido can either relay every Hosted AI request through its own inference
service or provision constrained OpenRouter access and keep the existing
direct request path. A relay would place private Board content in Eido's
infrastructure, duplicate streaming and provider-routing machinery, and make
Eido a data-plane dependency. Direct access exposes a user-specific credential
to a user-controlled device, where a sufficiently technical user can extract
it, but OpenRouter can enforce the credential's model access and financial cap
upstream.

OpenRouter's published Management API names SaaS distribution of unique keys
per customer as a supported use case. Its key limits and guardrails support
periodic spending caps, model/provider allowlists, and data-policy enforcement.
Eido treats the credential as an internal mechanism for delivering one benefit
of a broader paid product, not as a separately sold or normally transferable
API-access product. Because OpenRouter's general Terms also contain restrictions
on resale and transfer, Eido will document its interpretation and seek written
confirmation before public launch while continuing implementation.

## Decision

Hosted AI uses an Eido-operated control plane and OpenRouter's data plane. Each
Eido Account has at most one active generation of a distinct Eido-owned Hosted
AI Credential, shared across its authenticated installations. Every generation
has one immutable Funding Route, `free` or `paid`, which remains its usage-
attribution boundary after retirement. The service keeps a recoverable copy
under application-level envelope encryption with a dedicated KMS boundary; an
authenticated installation receives only that account's current credential
under a short-lived Credential Delivery Lease and through a local boundary
separate from BYOK. The desktop sends prompts, attachments, and streamed
responses directly to OpenRouter. Eido's service never relays or retains that
content.

A Route Transition never relabels a generation or overlaps active Eido-owned
credentials. The control plane disables the old generation, reads and
reconciles its Provider Usage High-Water, confirms the old credential is no
longer active, then rotates to a destination generation and records that
generation's provider-usage baseline before admitting work on the destination
Funding Route. Usage that OpenRouter accounts late against a retired generation
stays attributed to that generation's immutable route.

The control plane owns account and payment reconciliation, credit allocation,
usage metadata, and credential provisioning, constraint, rotation, revocation,
and recovery. OpenRouter—not the desktop—must enforce each credential's hard
financial cap and permitted model/provider catalog. The OpenRouter management
credential remains server-side and cannot be delivered to or used by the app.
The per-account limit is cumulative with no OpenRouter calendar reset. Eido
advances its absolute value idempotently from its own subscription-period and
credit ledger rather than mapping an account anniversary onto OpenRouter's UTC
monthly reset.

Production OpenRouter policy allows only Eido's exact remote model catalog,
requires zero-data-retention-compatible routing across every provider group,
and disables logging/data discounts, Broadcast, plugins, and tools unless a
later reviewed feature explicitly needs them. Server-side usage snapshots and
the shared prepaid balance are reconciled independently of desktop reports. A
low shared balance trips the Shared Balance Breaker before Eido promises spend
it cannot fund.

OpenRouter's published interfaces do not currently provide a documented
finality watermark for cumulative per-key usage. Eido therefore never infers
provider finality from an observation timestamp, an unchanged value, a quiet
interval, or a client report. Any operation that requires final usage remains
held as a Provider Drift Case until a provider-confirmed contract supplies that
evidence and Eido validates it with a disposable-account proof. Establishing
that guarantee is a public-launch gate, not a value Eido may fabricate in
production.

Credential extraction is an accepted, bounded consequence of direct access.
An extracted credential may consume only its owning account's allowance within
upstream constraints; it must not expose another account, the management
credential, or uncapped Eido funds.

## Considered Options

- Chosen: an Eido control plane with direct desktop-to-OpenRouter inference.
- Not chosen: an Eido inference relay, because its extra privacy, security,
  availability, latency, and implementation burden has no current product
  benefit.
- Not chosen: simultaneous free and paid credentials or changing a live
  generation's route, because either would permit overlapping financial
  authority and misattribute late provider usage.
- Not chosen: OpenRouter OAuth as Hosted AI, because a user-controlled,
  user-funded OpenRouter account is streamlined BYOK rather than Eido-funded
  Hosted AI.

## Consequences

- Hosted AI can reuse the current OpenRouter completion and streaming seam,
  but credential selection must distinguish Hosted AI from BYOK.
- The account service still exists, but it never needs raw prompt or response
  access. Operational records are limited to identity, entitlement, key
  lifecycle, usage/cost metadata, timestamps, and outcomes.
- Sign-out, compromise, refund, cancellation, payment failure, and entitlement
  changes require explicit credential lifecycle behavior.
- Replayed or stale delivery responses cannot re-authorize a retired
  generation; Credential Delivery Leases must be bound to the admitted action,
  generation, route, and policy revision.
- Restoring an account on another installation re-delivers the current
  account credential. A device-compromise response rotates it account-wide and
  all installations reacquire the new generation.
- Public launch includes an upstream-terms review and written OpenRouter
  confirmation request. A contrary response triggers an explicit architecture
  decision rather than an implicit inference-relay fallback.

## Amendment, 2026-08-24: selected models and exact generation cost

The earlier exact remote model-catalog allowlist is superseded. Free and Plus
share a static, release-shipped Recommended Model Catalog, but a person may edit
their device-local list or add any OpenRouter model by slug. A Plus account may
use its managed credential with any valid selected slug; the control plane
resolves only the minimum hidden availability and pricing metadata needed for
safe managed execution. It does not expose a second model catalog to the user.

OpenRouter automatically returns detailed usage on every response, including
native prompt, completion, reasoning, and cache counts plus `usage.cost`; a
stream carries it in its final SSE message. A generation ID can retrieve usage
metadata asynchronously for audit and response-loss recovery. Eido therefore
records every managed generation separately, settles confirmed provider spend
rather than a local token estimate, and aggregates all generations belonging to
one Eido Run into one minimal Account-history **AI** row.

Confirmed billable partial usage is charged exactly. Missing or ambiguous
provider cost is never guessed; the generation remains pending reconciliation.
This accounting remains content-blind and does not authorize OpenRouter content
logging or Broadcast.

The Hosted AI Credential remains invisible as product data: no view, copy,
export, or Profile storage is provided. Local access is removed on sign-out and
managed authority disables or rotates it upstream. Because direct inference
still delivers a credential to a user-controlled device, the existing accepted
extraction risk and mandatory upstream financial bounds remain unchanged.

One shared inference credential is rejected. If delivered to desktops, one
extraction could consume the shared pool outside Eido and could not be revoked
or capped per account. If retained behind Eido, it would require Eido to proxy
every AI prompt, stream, attachment, response, cancellation, and tool loop,
reversing the accepted privacy and availability design. The chosen hybrid keeps
one Eido-owned OpenRouter account, credit pool, and server-only management
credential while provisioning one constrained child credential per Eido user.

Eido implements the complete OpenRouter Management API lifecycle needed by
that deep module: create a unique child key, retain its write-only secret under
the existing encrypted authority, read provider usage and remaining limit,
advance or reduce its absolute limit, disable it, rotate it, and delete it when
the account lifecycle permits. The rest of Eido sees the small Hosted AI
credential lifecycle interface, not a generic vendor-management interface.

Each child key uses a cumulative USD spending limit with no daily, weekly, or
monthly reset. Eido advances its absolute limit only from canonically verified
Usage Balance funding and reconciles it against provider usage; a calendar
boundary can never mint customer spending authority.

When Plus ends, Eido disables the active child key. A later reactivation creates
a fresh generation instead of reviving a credential that may still exist on an
abandoned device. Signing out one installation removes only that installation's
local delivery because other authenticated devices share the account. **Sign
out all** or a suspected compromise rotates the child key account-wide and
requires every installation to reacquire the new generation.

Account deletion disables the child key immediately. Permanent provider-key
deletion waits until late usage, balance disposition, and any manual refund have
been reconciled and the required content-blind financial evidence is durable.
This stops access at once without erasing the facts needed to finish deletion
honestly.

Every managed OpenRouter request requires Zero Data Retention and denies
provider data collection. Prompt/completion logging, input/output data-sharing
discounts, Broadcast, and other content observability remain disabled even when
they would reduce provider price. A custom slug with no compliant endpoint is
unavailable through managed access; personal BYOK remains independent and
follows the person's provider arrangement.

The earlier requirement to obtain separate written OpenRouter approval is
superseded. OpenRouter's published Management API explicitly documents unique
keys for SaaS customer instances, automated limits, usage monitoring, disable,
and rotation; that published contract is Eido's implementation authority. A
normal launch-time dependency and terms review remains, but bespoke provider
permission is not a product launch gate.

Sources:

- [OpenRouter Usage Accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)
- [OpenRouter generation metadata API](https://openrouter.ai/docs/client-sdks/typescript/api-reference/generations)
- [OpenRouter Management API keys](https://openrouter.ai/docs/guides/overview/auth/management-api-keys)
- [OpenRouter create-key contract](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys)
- [OpenRouter model pricing object](https://openrouter.ai/docs/guides/overview/models)
- [OpenRouter Zero Data Retention](https://openrouter.ai/docs/guides/features/zdr)
- [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)

## Amendment, 2026-08-25: zero-price delivery authority is prepared, not served

The managed OpenRouter admission interface now accepts an all-zero provider
quote only under a short server-issued Credential Delivery Lease. The lease
binds the exact selected slug, compliant endpoint, quote revision,
`validUntil`, endpoint ZDR/data-collection posture, and the complete billable-dimension
vector: `prompt`, `completion`, `request`, `image`, `web_search`,
`internal_reasoning`, `input_cache_read`, and `input_cache_write`. A missing,
malformed, nonzero, stale, privacy-incompatible, unknown-dimension, or
conditional/tiered price fact fails closed. The current authority deliberately
refuses price arrays rather than guessing which tier applies. A recommendation
never participates in this decision. Endpoint ZDR does not prove workspace
logging or observability: those facts come from a separately revisioned,
exact server policy covering workspace, guardrail, discount, broadcast, and
content-observability posture.

The delivered request policy uses the quoted OpenRouter provider slug as its
only permitted provider and disables provider fallback. This turns the
endpoint quote into an enforceable direct-request constraint instead of
allowing OpenRouter's default load balancing to select an unquoted endpoint.
The quote also binds that endpoint feed's provider display identity. Canonical
generation metadata returns `provider_name`, not the routing slug, so
settlement compares that confirmed name with the name bound beside the slug;
it never pretends a display name is a valid `provider.only` value.

The public managed admission route now composes the real Account operational
revision, current Stripe entitlement and Tier publication, reduce-only PostHog
route decision, Usage Balance revision, live OpenRouter endpoint/ZDR quote,
durable provider-generation reconciliation, Management API, KMS envelope, and
the explicit workspace/guardrail/observability policy. One operation-scoped
semantic fingerprint binds all of those facts before any child cap can be
delivered. Provider creation starts at cap zero; after a cap change, every
authority is reread. Funding, deletion, Tier, flag, quote, endpoint, or privacy
drift closes delivery and requires confirmed provider disable. An exact retry
replays its durable generation; a changed fence drains the old operation and
derives a fresh deterministic operation instead of replaying a stale request
forever.

Issue #1234 adds durable per-Run generation settlement and a canonical
OpenRouter generation reader, but does **not** replace the structural
admission-finality interlock. OpenRouter documents the generation read with a
Bearer API key and does not guarantee that a disabled child key can read its
generation or that a Management key has cross-key generation-read authority.
Production serving therefore remains structurally closed pending #1236. An
enabled future path will atomically open a content-blind settlement aggregate
and its retry/outbox, then durably arm that aggregate immediately before
child-secret reveal. A zero-start terminal report may settle only before this
server-owned release fence; once armed, it remains indeterminate. The same gates apply to positive-price delivery: a
complete quote proves what may be delivered, while canonical generation
evidence proves what was actually spent. Neither substitutes for the other.

Hosted request bodies set both `provider.zdr: true` and
`provider.data_collection: "deny"`; managed delivery additionally requires
`provider.only` for the leased provider slug and disables fallbacks. This is
defence in depth beside the account/endpoint policy; BYOK request bodies remain
controlled by the person and unchanged. The Electron main route owns the short
lease and child credential, but not the money bounds. It submits the complete
content-blind operation, plan, selected provider model, and ordered
provider-call manifest. After its final Account, balance, quote, and workspace
rereads, the control plane derives one bounded request authority per manifest
item. Electron consumes that ordered authority immediately before direct
OpenRouter egress and rechecks model, policy revision, lease expiry, and
cancellation. It preserves provider generation identity and final usage without
content, reports the identity even when a later stream stage fails, and closes
the admitted Run with the exact indexes whose calls started. Settlement rejects
changed manifests, skipped required calls, and generation/model observations
that do not match their admitted index.
The documented `X-Generation-Id` response header is captured before status or
body decoding, so a post-acceptance response/body loss can still enter durable
generation-ID reconciliation.
The route bypasses legacy Paid admission and HostedCredentialMemory. The
tracer is composed but production does not publish it while #1236 remains the
mandatory serving gate; BYOK selection and request bytes are unchanged. None of these authorities
crosses renderer IPC, and the Eido control plane still receives no prompt,
attachment, or model output.

Canonical lookup binds generation ID, selected model, routed provider, exact
USD decimal, and native prompt/completion/reasoning/cache counts. OpenRouter's
APIs may return aliases for the same model or provider; such disagreement stays
indeterminate rather than becoming debit authority or an unexpected terminal.
Header and SSE aliases for the same generation ID remain one HTTP generation.
Missing final facts and reader failures remain **Pending** under durable retry. Lease expiry
alone cannot prove that no provider call started: an unclosed expired lease
remains pending rather than inventing a zero-cost terminal fact. Once every started generation is
final, their costs are summed at provider precision and applied through the
existing Usage Balance authority with one Run-scoped idempotency key and one
minimal **AI** history row. Partial/failed visible output uses
`confirmed-partial`. An action that reached this route as the single Eido-managed
retry of a definitively rejected personal key (ADR 0048) marks that same one row
`confirmed-personal-key-fallback` or `confirmed-partial-personal-key-fallback`
rather than adding a second row; the marker names the funding route only.
Zero cost closes only from exact canonical zero; confirmed
zero-cost provider work still produces its one concise `$0` **AI** row, while
an admitted lease that starts no provider call produces none. Confirmed
overrun records full cost, clamps the balance to zero, and retains Eido's
absorbed variance. A crash between debit and aggregate close is harmless: the
Usage Balance command replays exactly. Before any debit, the aggregate
compare-and-sets the exact generation/finality digest from `pending` to a
durable `settling` seal. That seal freezes observation/close membership; a
crash resumes the same exact debit and only then advances to `settled`.
Reordered observations remain admissible up to the declared started count
before sealing, while movement at the seal stays pending with zero debit.
