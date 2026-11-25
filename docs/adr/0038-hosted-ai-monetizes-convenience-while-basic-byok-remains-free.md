# ADR 0038: Hosted AI Monetizes Convenience While Basic BYOK Remains Free

Status: superseded by ADR 0051 on 2026-10-27.

Historical decision. The founder removed this commercial architecture in [ADR 0051](0051-free-open-source-byok-only.md). Do not implement or operate it from this record.

## Context

Eido is adding paid AI access while preserving its local-first philosophy. A
literal paywall around every AI execution would force people who already fund
and configure their own provider credential to pay Eido for access to their
own inference, while making the installed product less self-directed. The
alternative is to monetize the convenience and operating cost of Eido-supplied
AI separately from basic user-funded access.

## Decision

Basic Bring Your Own Key (BYOK) access remains free. Eido's paid recurring
offer applies to Hosted AI: Eido-operated access to a broader supported model
catalog with included usage and optional additional usage. The free experience
may also include limited Hosted AI through one Eido-selected model.

A future one-time purchase may unlock advanced AI capabilities such as CLI
execution and additional local or subscription-backed provider adapters, but
it does not become a prerequisite for basic BYOK.

## Considered Options

- Chosen: monetize Hosted AI convenience and advanced capabilities while
  preserving free basic BYOK.
- Not chosen: require a recurring subscription for all AI, because that breaks
  the local-first escape hatch and charges users for access to inference they
  already fund.
- Not chosen: place basic BYOK in the future one-time purchase, for the same
  reason; that purchase should represent additional product capability.

## Consequences

- Entitlements must distinguish an execution route from an advanced feature:
  Hosted AI can be plan-limited while basic BYOK remains available.
- Paywall copy must not imply that Eido owns or meters usage sent through a
  person's own provider credential.
- Hosted AI outages or account problems must not disable basic BYOK or local,
  non-AI Board work.

## Amendment, 2026-08-19

Founder decision after web mode and research mode shipped on `main` (#955).
That work was built before this ADR's scope was set, and it changes what
"basic BYOK" covers.

### What changed

The recurring subscription now unlocks six things, not one:

1. the Eido-funded OpenRouter allowance,
2. web mode,
3. research mode,
4. the Linkup API key field in Settings,
5. the `eido` CLI,
6. using a local AI harness as the provider.

Items 5 and 6 were previously reserved for a possible one-time purchase. That
purchase is no longer planned as the route to them. The recurring subscription
carries them instead.

### The free promise is now current behaviour, not a commitment

The original decision read as a durable promise that basic BYOK stays free.
It is amended to a weaker and more honest claim: BYOK access to Ask,
Conversation, chains, follow-ups, variations, and Mods is free today, and Eido
does not intend to charge for it, but this ADR no longer records that as a
permanent commitment.

### Two deliberate exceptions to "never meter someone's own credential"

The Consequences section says paywall copy must not imply Eido meters usage
sent through a person's own provider credential. Two gates now sit in tension
with that, knowingly:

- **The Linkup key field is subscription-gated.** A person supplies and pays
  for their own Linkup key, and Eido still requires a subscription before the
  field appears. Eido does not meter that spend and must not imply it does.
  What the subscription sells is the capability, not the inference.
- **Local AI harnesses are subscription-gated.** `claude-code`, `codex`,
  `gemini`, and `antigravity` run on the person's own machine under their own
  provider subscriptions.

Both are the same shape: the subscription unlocks a capability, and the person
still funds the work. Copy must say that plainly rather than implying Eido
supplies or measures the underlying service.

### Enforcement is honest about what it can hold

Gates divide by whether Eido holds a secret the feature needs.

- **Real gates.** Hosted AI works because Eido holds the OpenRouter
  credential. A modified client still has no key, so the gate holds by
  construction.
- **Signs.** The CLI, local harnesses, the Linkup key field, and BYOK web mode
  run on the person's machine with their own credentials. No client-side check
  can be made tamper-proof. Eido accepts that and will not spend effort on
  anti-tamper machinery.

Both kinds are implemented the same cheap way and neither is described as
stronger than it is.

### No grandfathering by default

Friends Alpha users who have the CLI and local harnesses today lose them
unless they subscribe. Individual exceptions are granted manually rather than
by an automatic rule.

## Amendment, 2026-08-23: Free means BYOK, never Eido-funded usage

The commercial model is reversed where the earlier decision put product
capabilities or a small Eido-funded allowance behind the subscription.

**Free includes every Eido product capability.** Ask, Conversation, Web Mode,
Research Mode, CLI execution, local harnesses, and provider-key settings are
not Plus features. Where an external service is required, Free uses a
credential the person supplies and funds. Research Mode specifically requires
the person's Linkup key and is disabled without it.

**Free includes zero Eido-funded provider usage.** There is no free Hosted AI
turn, free daily quota, daily reset, free managed credential, free allowance,
or free managed funding route. No equivalent may survive under a different
label. Free and Plus do share the same editable model-selection surface, seeded
by a static Recommended Model Catalog in each Eido release; this recommends
models but funds none of them. Eido-managed OpenRouter and managed Linkup Web
Mode require current Plus access and available Usage Balance.

The founder may update those recommendations frequently as new models arrive.
A person can edit the list or add an OpenRouter model by slug at any time. The
catalog is not split by Tier and is not itself permission or billing authority.
Personal edits stay in device-local settings rather than syncing through the
Eido Account or entering Profile/Portable data; only the selected model identity
needed for Idea reproducibility is persisted with that Idea.

Compatibility with the released browser shape is deliberately bounded. While
the device catalog is still implicit (never after a person has edited it),
opening a legacy Idea may union structurally valid multi-entry OpenRouter lists
from its old per-Idea settings into the device-local catalog. An absent
`aiSettings` value and a selected-identity singleton are not catalog evidence,
and an explicit device catalog is never overridden. The migration writes only
the device settings seam; current Board/Profile writes and Portable Export keep
the selected identity only.

A Plus account may use managed Usage Balance with any valid OpenRouter model
slug it adds, not only a shipped recommendation. The AI Control Plane resolves
only the minimum provider metadata required to verify that the model is
available and safely meter its price. That metadata supports backend authority
and is invisible in the product; Eido does not create a second user-facing
catalog. If price cannot be verified, managed execution waits or fails safely,
while a personal-key route may still attempt the user-supplied slug directly.

When a Free person attempts provider-backed work without a usable personal
credential, Eido offers **Try Plus** as the primary action and **Add Key** as
the secondary action. This is a convenience offer, not a locked product
feature: adding the key makes the same capability usable on Free. **Try Plus**
opens the disclosed paid purchase flow; it does not start a free trial or grant
free managed usage.

PostHog cannot reverse this boundary. Tier policy grants the product
capabilities; operator flags may stage or withhold managed routes and reveal
locked Plus convenience, but BYOK remains available under the Free policy.

An Eido Account is required for Plus and every Eido-managed route, but not for
local work or BYOK. A configured personal key is first-class, direct provider
access: its successful path does not sign in or consult Eido's account service,
Tier policy, PostHog controls, Usage Balance, or managed-route health. An Eido
service outage may be reported by a simple app toast when observed, but it must
not turn into a prerequisite check or failure for personal-key work.

Plus state, Usage Balance, Auto-Recharge, and content-blind Account history are
shared by every device signed into the same Eido Account. Managed OpenRouter is
provisioned per user rather than purchased per device. Personal provider keys
remain device-local and are never synced through the account service.

The earlier 2026-08-19 amendment's subscription gates for Web Mode, Research
Mode, the Linkup key field, CLI execution, and local harnesses are superseded.
Its honest-enforcement distinction remains useful, but those local/BYOK
capabilities are no longer gated by Plus.

This change occurs before commercial launch: Eido has zero paying Plus
customers and no production Usage Balance liability. Implementation therefore
replaces the old US$15/allowance/free-route/pack product rather than running two
commercial models or grandfathering one. Development and sandbox state may be
reset or migrated through disposable proof, while persisted schemas receive
only the compatibility work required for supported software.
