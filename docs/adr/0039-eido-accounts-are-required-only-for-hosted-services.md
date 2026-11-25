# ADR 0039: Eido Accounts Are Required Only for Hosted Services

Status: superseded by ADR 0051 on 2026-10-27.

Historical decision. The founder removed this commercial architecture in [ADR 0051](0051-free-open-source-byok-only.md). Do not implement or operate it from this record.

## Context

Hosted AI needs a stable online identity for abuse prevention, usage metering,
subscription and purchase entitlements, account recovery, and use across
installations. Making that identity a prerequisite for the whole installed
app would conflict with ADR 0009's local-first, optional-cloud boundary and
would make local Boards depend on Eido's service availability.

## Decision

An Eido Account is required for Hosted AI, including its limited free access,
and for paid Eido services or entitlement recovery. An account is not required
for local Boards, non-AI features, or basic Bring Your Own Key access.

The Eido Account and the local Profile are separate authorities. Signing out,
an account problem, or an Eido service outage can disable Hosted AI and online
entitlement refresh, but must not make local Board data unavailable or disable
basic BYOK.

## Considered Options

- Chosen: require identity at the Hosted AI boundary only.
- Not chosen: anonymous Hosted AI, because Eido could not reliably meter free
  access, contain abuse, or restore paid access.
- Not chosen: a mandatory account for the installed app, because optional
  online services must not become ownership of local work.

## Consequences

- Desktop authentication and entitlement state must be additive to Profile
  storage rather than embedded as Board authority.
- Hosted requests must authenticate an Eido Account; possession of an install
  or public client identifier is not sufficient authorization.
- Account deletion and sign-out need explicit treatment for online records
  while leaving locally owned Board data under the person's control.

## Amendment, 2026-08-19

Founder decision: the `eido` CLI and local AI harnesses become subscription
capabilities. See the amendment in ADR 0038.

This creates a real tension with the Decision above. The `eido` CLI reads and
writes the local Profile, so gating it puts an account check between a person
and data that lives on their own disk.

### How the local-first promise is preserved

The promise this ADR protects is that **Boards open and work in the app**
without an account. That stays exactly true. Nothing about the desktop
application's access to local Boards changes.

The CLI is an agent automation surface. It is a convenience for driving Eido
from a terminal or from a coding agent, not the route a person takes to reach
their own work. Local harnesses are the same shape: they are an alternative AI
provider, and BYOK OpenRouter remains available without a subscription, so AI
still works without paying.

### What must remain true

- The desktop application opens local Boards with no account, no network, and
  no entitlement check. This is not negotiable and no capability gate may sit
  in that path.
- A capability check that cannot reach the control plane must never remove
  local Board access.
- Local unlocks carry a much longer offline grace than Hosted AI spending
  authority. Hosted spending fails closed quickly because Eido's money is at
  risk; a local capability risks nothing, so a subscriber who is offline keeps
  working. Both durations are versioned server policy.
- Portable Export, Board files, and Profile data stay reachable without a
  subscription by some supported route.
