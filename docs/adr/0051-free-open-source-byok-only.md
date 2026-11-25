# ADR 0051: Free open-source Eido uses only user-funded providers

Status: accepted on 2026-10-27. The network policy was narrowed on 2026-11-25.

## Context

The founder directed Eido to become free to use forever, with its entire project
prepared for open-source publication. Eido must continue to work as a local
thinking board. People supply and fund their own online provider credentials.

## Decision

Remove Eido accounts, sign-in, sign-up, subscriptions, paywalls, paid CLI access,
credits, billing, Stripe, Clerk, managed OpenRouter credentials, managed Linkup
relays, commercial feature flags, the AI control plane, and its operator console.
No Eido-operated service admits, funds, meters, or gates AI or web work.

Boards, attachments, storage, exports, CLI, and MCP work offline. Online AI uses
the person's own OpenRouter key or a supported installed AI tool, including
Codex, Claude Code, and Antigravity. Installed tools connect through their own
providers. Optional web search, reading, and research can use Linkup with the
person's key. The person pays their providers directly.

Webpage previews can contact public pages and their preview asset hosts when a
person pastes a link or views a saved preview. Opening a link hands it to the
system browser. The renderer can send internet requests only to the OpenRouter
and Linkup API endpoints Eido uses.

Release the project under GNU GPL version 3. Remove product analytics and all
PostHog runtime/configuration dependencies. The Cloudflare website serves manual
downloads. Keep the signed feed for existing installations that still use it.
Remove update checks and downloads from the new desktop app. Windows installers
remain unsigned.

## Compatibility and operations

Existing Profiles remain readable. Historical `managed`, `hosted-free`, and
`hosted-paid` route evidence is accepted only as stored provenance, never as
permission to execute or an active funding option. Do not rewrite saved content
or delete a Profile to remove the commercial product.

Removing repository code does not shut down deployed services, cancel vendor
plans, revoke secrets, or resolve any existing customer financial obligations.
See the [open-source handover](../agents/open-source-handover.md) for that boundary
and remaining owner costs. Production shutdown is a separate external operation.

## Superseded decisions

This decision supersedes the Hosted AI, Eido Account, billing, managed-provider,
commercial flag, and operator-console ADR family 0038 through 0050 by title.
The local execution and storage ADRs sharing numbers in that range remain
accepted. The new desktop app replaces the earlier automatic update flow with
manual downloads. Historical research and retrospectives describe earlier
versions of the product.
