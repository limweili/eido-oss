# ADR 0050: The Operator Console Is a Narrow Control-Plane Module

Status: superseded by ADR 0051 on 2026-10-27.

Historical decision. The founder removed this commercial architecture in [ADR 0051](0051-free-open-source-byok-only.md). Do not implement or operate it from this record.

Related: [Hosted AI Is a Control Plane Over Direct OpenRouter Access](0040-hosted-ai-is-a-control-plane-over-direct-openrouter-access.md),
[Hosted AI Additional Usage Is Prepaid](0041-hosted-ai-additional-usage-is-prepaid.md),
[Stripe Is Billing Authority; Entitlements Are Eido Projections](0043-stripe-is-billing-authority-entitlements-are-eido-projections.md),
and [The Account Record Decides What Can Be Done; Flags Decide What Is Seen](0047-the-account-record-decides-what-is-done-flags-decide-what-is-seen.md)

Delivery note (2026-08-26): this decision stands and is not amended. What
shipped in epic #1212 diverges from it in one respect that a reader should not
have to discover from source.

**There is no web console.** The decision above says the AI Control Plane
"serves a private Operator Console", and #1223 and #1245 built the module
behind that console rather than the console itself. What exists is an
authenticated HTTP command interface with no browser surface:

| Route | What it does |
| --- | --- |
| `GET /operator/v1/overview` | Content-blind overview |
| `GET /operator/v1/health` | Service and backlog health |
| `GET`, `POST /operator/v1/policy` | Read and publish commercial-policy revisions |
| `POST /operator/v1/account/lookup` | Per-account operational facts |
| `POST /operator/v1/account/managed-key/disable` | Disable one managed child credential |
| `POST /operator/v1/account/managed-key/rotate` | Rotate one managed child credential |
| `POST /operator/v1/account/reconciliation/retry` | Retry one named reconciliation |

The narrow-module half of the decision is fully built and behaves as written.
The founder allowlist, MFA on every route, server-side default-deny, expected
revision, idempotency key, operator reason, content-blind before and after
fingerprints, and the refusal of balance edits, entitlement grants, refunds,
raw SQL, secret viewing and arbitrary provider calls are all in place and
tested.

The missing surface is a genuine gap rather than a change of mind, because this
ADR's "Considered Options" explicitly rejects CLI-only administration on the
grounds that the MVP needs a glanceable confirmation surface. It is tracked as
[#1289](https://github.com/limweili/eido/issues/1289).

Two smaller divergences in the same direction:

- **Account lookup takes an Eido Account identifier only, not an email.** The
  decision offers "an Eido Account identifier or exact email". The control
  plane stores a one-way identity fingerprint and no email, so lookup by email
  is not merely unbuilt, it is not currently possible.
- **Lookup is a POST although it reads.** That is deliberate, so an account
  identity never lands in a URL, a log line, or a Referer header.

## Context

Eido Plus introduces server-owned commercial policy, provider credentials,
shared prepaid funds, asynchronous Stripe facts, managed Linkup metering, and
durable reconciliation. The founder needs a small way to observe and operate
those mechanisms without waiting for a desktop release or editing production
data directly.

A generic administration system would be more dangerous and expensive than the
product it supports. Stripe already owns subscription, payment-method, invoice,
receipt, cancellation, and refund work. PostHog already owns rollout flags.
OpenRouter and Linkup already own their provider dashboards. Eido needs only the
narrow controls and content-blind evidence that are authoritative inside its own
AI Control Plane.

## Decision

### One founder-only web console

The AI Control Plane serves a private Operator Console outside the desktop app.
It uses Eido's authenticated account identity, an exact founder allowlist, and
MFA. Authorization defaults closed and is checked server-side on every read and
command; a hidden URL or client-side control is not authority.

The console is deliberately plain and desktop-release-independent. It does not
need a customer design surface, mobile layout, plugin system, generic query
builder, or arbitrary job runner.

### A small versioned commercial-policy editor

The console reads and publishes immutable revisions of only Eido-owned policy:

- Processing Fee percentage and minimum;
- Usage Balance purchase minimum and maximum;
- low-balance/Auto-Recharge threshold;
- automatic recharge cooldown bands; and
- managed-route shared-balance breaker posture.

An edit shows the complete proposed revision, requires an explicit confirmation
and short operator reason, then publishes one new server-authoritative revision.
Existing purchases and financial operations remain pinned to the revision they
accepted. Provider data never edits policy automatically.

Stripe prices and billing operations remain in Stripe. Feature rollout and
withholding remain in PostHog. The console may link to those systems but does
not duplicate their controls.

### Content-blind monitoring and bounded commands

The MVP overview shows service/provider health, shared-balance breaker state,
pending and failed payment/provider work, reconciliation backlog, and Provider
Drift Cases. Account lookup accepts an Eido Account identifier or exact email
and returns only operational facts: Tier, balance, recharge posture, provider
credential generation/state, and content-blind financial/reconciliation
history.

The only account commands are:

- disable or rotate one managed OpenRouter child credential;
- retry one named, retryable reconciliation operation; and
- copy opaque identifiers needed for provider or Stripe support.

There is no direct balance editor, entitlement grant, refund button, raw SQL,
secret viewer, prompt/result viewer, arbitrary provider request, or generic
background-job trigger. Refunds remain in Stripe and flow back through verified
events; managed rollout remains in PostHog.

### Every mutation is attributable and replay-safe

Each command requires the authenticated operator, timestamp, reason, target,
expected revision, and idempotency key. Eido records content-blind before/after
state fingerprints and the resulting operation identity. A retry of the same
command is safe; a conflicting reuse fails closed. Secrets, customer content,
provider payloads, and payment details never enter the audit record.

## Considered Options

- **Chosen: a narrow founder-only web console.** It gives the founder enough
  leverage to operate server authority without distributing production tools or
  coupling policy to desktop releases.
- **Not chosen: a generic admin framework or database browser.** Its interface
  would expose far more destructive capability than the product needs.
- **Not chosen: desktop admin controls.** Supported old clients cannot be
  pricing authority, and customer binaries are the wrong place for operational
  credentials.
- **Not chosen: duplicate Stripe/PostHog interfaces.** Those systems remain the
  authority for billing management and feature rollout respectively.
- **Not chosen: CLI-only administration.** A CLI may later automate exact
  commands, but the MVP needs a glanceable monitoring and confirmation surface.

## Consequences

- The founder can update server commercial policy without an app release while
  every accepted financial operation remains revision-pinned.
- Operational intervention is small, auditable, and content-blind.
- The console cannot repair a balance or entitlement by editing state; it must
  drive the same durable domain commands and reconciliation seams as production.
- Adding a control requires a new bounded domain command and an explicit reason
  why Stripe, PostHog, or the provider's own dashboard does not already own it.
- Broader support roles, delegated administration, analytics dashboards, and
  bulk actions are deferred until real operational evidence justifies them.
