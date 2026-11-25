# ADR 0042: Clerk Owns Hosted Account Authentication

Status: superseded by ADR 0051 on 2026-10-27.

Historical decision. The founder removed this commercial architecture in [ADR 0051](0051-free-open-source-byok-only.md). Do not implement or operate it from this record.

## Context

Hosted AI and paid entitlements require an online identity that survives across
personal installations. Eido does not want to build and maintain password,
email-verification, OAuth-provider, session-rotation, or account-recovery
infrastructure. At the same time, the installed app must not turn account
identity into ownership of the local Profile or Boards.

## Decision

Clerk is the proposed identity provider for Eido Accounts behind an
Eido-owned, provider-neutral account contract. The initial methods are
passwordless email code and Google, both owned by Clerk's hosted Account Portal.
Eido is a public OAuth/OIDC client: Electron main starts Authorization Code with
S256 PKCE, `state`, and `nonce`, opens the system browser, and receives exactly
one callback on a short-lived, dynamically ported `127.0.0.1` loopback
listener. It validates and exchanges the result; the renderer receives only a
sanitized account projection.

> **Reversed 2026-08-19** for the refresh token only. See "Amendment 2026-08-19:
> the refresh token moves into the operating system keychain" at the end of this
> file. The paragraph below is kept as the original position; do not act on it.

Launch requests no `offline_access`. Access and ID tokens, PKCE material, and
the pending transaction exist only in Electron-main memory. No Clerk token is
persisted in Eido's existing same-OS-account credential file, Profile, Board,
browser storage, argv, logs, telemetry, or a custom URL scheme. App restart,
token expiry, or verified revocation returns the desktop to signed-out state
and requires system-browser authorization again.

Clerk identity is optional for the local product. It identifies Hosted AI,
payments, and account-bound entitlements; it does not own, sync, or gate the
local Profile, Boards, or basic BYOK.

## Considered Options

- Chosen: a managed identity provider, because auth security and recovery are
  not Eido's product differentiation.
- Not chosen: Eido-maintained passwords and OAuth integrations, because their
  ongoing security and operational burden is disproportionate.
- Not chosen: renderer-only token storage or an embedded credential webview,
  because a packaged desktop app needs a hardened native/session boundary and
  system-browser authentication.
- Not chosen: persistent Clerk refresh tokens at launch, because Clerk's public
  material does not establish the RFC 9700 rotation, reuse detection, sender
  constraint, bounded lifetime, and revocation semantics needed to justify a
  durable bearer credential under Eido's no-Keychain/DPAPI policy.
  **Reversed 2026-08-19**; see the amendment at the end of this file. The
  no-Keychain policy this line depends on no longer holds for this one
  credential, and the live instance answered the revocation question.
- Not chosen: a custom desktop URL scheme, because Clerk and native-app OAuth
  support an ephemeral loopback flow without cold-launch handler ownership.

## Consequences

- The AI Control Plane validates Clerk-issued identity and maps exactly one
  internal account identity to Stripe and Hosted AI resources.
- Callback correlation, replay defense, token refresh/revocation, account
  deletion, multi-installation sessions, provider-linking collisions, and
  Clerk outage behavior are explicit integration scope.
- Seamless sign-in persistence across process restarts is not a launch promise.
  Adding it requires written Clerk confirmation plus a new custody ADR; it must
  not silently enable `safeStorage`, Keychain, DPAPI, or plaintext refresh-token
  storage. **Reversed 2026-08-19.** Persistence is now a promise, and the
  custody terms this line demanded are recorded in the amendment at the end of
  this file rather than in a separate ADR. The word that still holds is
  *silently*: `safeStorage` is enabled at exactly one named wiring site, and
  plaintext refresh-token storage stays refused.
- If Clerk research disproves the required Electron flow, cost envelope, data
  posture, or account-linking semantics, the identity provider changes behind
  Eido's account contract rather than leaking Clerk types across the product.
- Public launch remains gated on Clerk confirming first-party packaged-client
  support, first-user Account Portal continuation, no-refresh behavior, OAuth
  Hobby pricing/limits, and individual deletion semantics, plus a disposable
  macOS and Windows packaged canary.

## Amendment 2026-08-19: Account Portal self-deletion is turned off

This amendment carries one deliberate reversal. The rest of the live-instance
evidence, and the renderer-SDK conclusion, land separately through #1014.

### The reversal

Clerk's Account Portal self-deletion (`delete_self`) is **disabled** on the Eido
instance. Account deletion is only ever started from inside Eido.

This deliberately reverses this ADR's own treatment of self-deletion as
satisfying the "individual deletion semantics" launch gate (epic #1009,
2026-08-19; ADR 0046 owns deletion and is the later, more specific decision).
It reverses it only for **where deletion starts**: the requirement that a person
can delete their own account, in full, without asking anyone, is unchanged and
still a launch gate. What changes is the door.

The reason is ordering, not permission. ADR 0046 decided deletion is an
Eido-owned freeze-first saga: one transaction marks the account
deletion-pending and denies Hosted AI, purchases, and entitlement mutation
*before* any destructive provider effect, and identity is removed last, after
the OpenRouter credential is disabled and the Stripe case is snapshotted. That
same ADR already rejected the alternative in terms that apply exactly here:

> Not chosen: Clerk user deletion as a cascade trigger, because authentication
> teardown does not prove Eido, Stripe, or OpenRouter cleanup.

With `delete_self` enabled, a person could start at the wrong end. The freeze
never runs, so a funded OpenRouter credential Eido pays for stays live and a
Stripe subscription keeps billing, with no identity left to reconcile either
against. That was verified as a live configuration on the development instance,
not inferred: `user_settings.actions.delete_self` was `true` and the hosted
portal was reachable.

Turning it off removes a bypass, not a capability.

### Consequences

- The launch gate on individual deletion semantics is satisfied by Eido's own
  deletion path completing the ADR 0046 saga, not by Clerk's portal offering a
  delete button.
- A Clerk `user.deleted` webhook remains worth building as reconciliation for
  the window where a deletion happened outside Eido, and is explicitly **not** a
  substitute for the saga: it arrives after identity is gone, cannot perform the
  saga's opening reverification, and has at-least-once delivery with no ordering
  guarantee. ADR 0046 already states that provider webhooks reconcile operations
  but never coordinate the deletion transaction. No Clerk webhook handling
  exists in the repository today; that gap is recorded on #879.
- Disabling `delete_self` is a Clerk dashboard setting and a founder action. It
  is tracked as a FOUNDER-SETUP item on #1009 rather than performed by an agent.
  **Done on 2026-08-28: `delete_self` is now off in the Clerk dashboard.** That
  FOUNDER-SETUP item is closed. Recorded in
  `docs/monetization/founder-actions.md` section C3.

## Amendment 2026-08-19: live-instance evidence, and the desktop client decision

This ADR was written before anyone could inspect a real Clerk instance. One now
exists and has been inspected read-only. This amendment records what was
confirmed, what was corrected, and one decision that superseded an earlier
position taken during the same epic. Status of the ADR moves from proposed to
accepted for the desktop flow; the launch gates listed at the end remain open.

### Confirmed: the decided flow works against real Clerk

Instance `ins_3I65nYxzhKSJnGg8ZwSDPCgxcwj`, `environment_type: development`,
publishes a full OIDC discovery document with `code_challenge_methods_supported:
["S256"]`, `token_endpoint_auth_methods_supported` including `none`,
`response_types_supported: ["code"]`, `id_token_signing_alg_values_supported:
["RS256"]`, plus `revocation_endpoint` and `introspection_endpoint`. The `none`
auth method is what makes a public desktop client legal without a secret.

This is the concrete evidence the packaged-client launch gate asked for. It is
not the same as a completed packaged canary on macOS and Windows, which stays
open.

### Confirmed: Electron main owns the flow, and the renderer SDK does not

`@clerk/clerk-react` is not used, and must not be. Five lines of evidence:

1. Clerk's own guidance for an app on a person's machine recommends localhost
   callback plus PKCE, cites **RFC 8252 §7.3**, and specifies binding
   `127.0.0.1:0` with the redirect URI registered as `http://127.0.0.1/callback`.
   That describes what `electron/desktopAccountSession.ts` already implements.
2. Clerk does not offer its React SDK for this pattern; its worked example uses
   Node primitives.
3. ClerkJS's session mechanism is a browser cookie. Its reference documents
   `isStandardBrowser` being false on "native platforms where cookies cannot be
   set", which establishes cookies as the assumed mechanism and non-cookie
   contexts as a separate case. A page served over `eido://` has an opaque
   origin, where cookie storage and the Frontend API handshake are undefined.
4. Clerk's instruction for native contexts is to carry a bearer token instead of
   relying on origin-based session handling. Its allowed-origins model is a
   browser-shaped protection an opaque origin cannot participate in.
5. Clerk's native-app registration is keyed on package name and SHA-256
   certificate fingerprint, which are Android and iOS concepts. **Clerk has no
   first-class Electron story.** This ADR says so plainly rather than implying
   one exists.

The decisive point is independent of whether it would load: ClerkJS exists to
*hold* a session in the client, which is the opposite of this ADR's decision. A
control built on it would render convincingly and then persist a session.

### Recorded divergence: Clerk recommends credential storage, Eido refuses it

> **Reversed 2026-08-19.** The divergence recorded here is over, in one
> direction only. Eido now takes the keychain half of Clerk's advice and still
> refuses the `chmod 600` half. The section is kept because a future reader
> needs to see that the refusal was reasoned rather than absent-minded, and that
> the part still refused is the part that was always the weaker idea.

Clerk's desktop guidance recommends storing credentials in the OS keychain with
a `chmod 600` JSON fallback, and issuing refresh tokens to keep people signed in
across restarts.

Eido deliberately does the opposite, and `REQUESTED_SCOPE` in
`desktopAccountSession.ts` is `openid email` with no `offline_access`. Eido
gives up sign-in persistence across restarts in exchange for holding no
credential at rest on the person's machine. Clerk's advice is written for tools
whose users live in a terminal; re-authorising through the system browser is a
modest cost against never having a stealable credential on disk. Changing this
still requires the separate custody ADR this document already demands.

### Corrected: the enabled sign-in methods did not match this ADR

This ADR and `docs/monetization/README.md` both state the initial methods are
passwordless email code and Google. The live instance did not match:
`email_address` with `email_code` matched, but **`password` was enabled and
required**, and **`oauth_apple` and `oauth_facebook` were enabled** alongside
Google.

Resolution: the instance changes to match this ADR. Passwordless email code and
Google only. Recorded as a founder action on #1009. Sign-up also has smart
CAPTCHA enabled, which is correct for a system-browser flow because a human
completes it, and would be a hard blocker for any embedded credential form.

### Decision: opaque access tokens, and the revocation window is 60 seconds

The AI Control Plane verifies Clerk-issued OAuth access tokens. The OAuth
application must be configured to issue **opaque** tokens, and verification goes
through Clerk rather than offline.

**The revocation staleness window is 60 seconds.** That number is the security
parameter of the whole design, and it means exactly one thing: *the maximum time
a signed-out, revoked, or deleted person keeps working.* Positive verification
results are cached for that window; negative results are never cached, because a
cached positive extends access as a bounded risk priced by the TTL, while a
cached negative denies access and lets an unauthenticated caller influence what
the service remembers.

> **Superseded 2026-08-19.** An earlier position in this same epic accepted
> Clerk's default JWT access tokens with offline JWKS verification, giving a
> revocation staleness window of up to **86,400 seconds**. That was reversed on
> the ground that a revoked credential continuing to work for up to a day is not
> acceptable for a paid product's authentication boundary, which is precisely
> why Clerk offers opaque tokens. The superseded position is kept here rather
> than deleted, because the failure mode is a future reader acting on the older
> half of a decision. The JWT verification path remains implemented and correct;
> a JWT arriving is treated as evidence the OAuth application was created with
> Clerk's default and the explicit opaque choice was missed.

### Launch gates that remain open

The packaged macOS and Windows canary, first-user Account Portal continuation
proved end to end, and OAuth pricing and limits. Additionally, and newly: **no
OAuth application exists yet**, so no genuinely Clerk-signed token has ever been
verified. Every positive-path verification is fixture-backed. Obtaining one real
token is the first thing that must happen once the application exists.

## Amendment 2026-08-19: the refresh token moves into the operating system keychain

This amendment reverses the central custody decision of this ADR. It is the
second reversal recorded here, and like the first it keeps the old position
visible rather than deleting it, because the failure mode is a future reader
acting on the older half in good faith.

### The reversal

Eido holds **one** credential at rest: the Clerk OAuth **refresh token**, in the
operating system's protected store. Everything else stays as it was. The access
token, the ID token, PKCE material, and the pending transaction remain in
Electron-main memory and die with the process.

The original position, kept intact:

> Launch requests no `offline_access`. Access and ID tokens, PKCE material, and
> the pending transaction exist only in Electron-main memory. No Clerk token is
> persisted in Eido's existing same-OS-account credential file, Profile, Board,
> browser storage, argv, logs, telemetry, or a custom URL scheme. App restart,
> token expiry, or verified revocation returns the desktop to signed-out state
> and requires system-browser authorization again.
>
> Not chosen: persistent Clerk refresh tokens at launch, because Clerk's public
> material does not establish the RFC 9700 rotation, reuse detection, sender
> constraint, bounded lifetime, and revocation semantics needed to justify a
> durable bearer credential under Eido's no-Keychain/DPAPI policy.

The honest framing is that the original choice was **correct on security
grounds and lost on product grounds**. Nothing about it was careless. Holding no
credential at rest is a genuinely stronger property than holding one, and no
amount of keychain hardening recovers it. The reversal is a trade, not a
correction, and the keychain is what makes the trade acceptable rather than what
makes the old position wrong.

### Why it was reversed

The offline-grace review found the cost, filed as #1037. #995 built a thirty-day
offline capability grace window that works correctly at the capability seam and
was **unreachable in practice**: `presentHostedAccount` empties the capability
list the moment the account session expires, and the session expired with the
OIDC access token, roughly an hour, because nothing could renew it without a
network. A subscriber who closed the lid and opened it on a plane the next day
got about an hour of paid features, not a month, and had to sign in again on
every reconnection.

The founder was shown both options with their costs on
`docs/monetization/founder-actions.md` (item E2), including a recommendation
that named the security loss, and decided on 2026-08-19: **store it in the
keychain**. Requiring a fresh sign-in roughly hourly on a local-first thinking
tool is the kind of friction that stops people opening the app at all.

The ordering that makes the fix work is worth stating plainly, because getting
it backwards would break the invariant #995 was built to protect: a refresh
token lets the session renew, renewal keeps the snapshot fresh, and a fresh
snapshot is what gives grace something to restate. **Grace itself did not
change.** It still only ever restates an availability that the last fresh
entitled snapshot literally granted, and it still never widens an authorization
decision. The boundary test in `src/desktop/hostedAccountCapabilityGrace.test.ts`
still asserts that an expired session empties the capability list; what moved is
where the session boundary sits, and it moved at the account session seam that
owns it, which is exactly where #1037 said the decision belonged.

### The custody terms

These are the conditions the trade was accepted under. They are not
implementation detail; weakening any of them re-opens the decision.

- **Only the refresh token persists.** The access token stays memory-only.
- **The operating system's protected store, or nothing.** Electron
  `safeStorage`, which is macOS Keychain, Windows DPAPI, and the Linux secret
  service. Chosen over a direct native keychain binding because Eido ships zero
  native dependencies today, and adding one would put signing, notarization, and
  universal-binary packaging in the path of an authentication change. What lands
  on disk is ciphertext plus a plaintext frame carrying a version and the
  session deadline, in `userData/account/`, beside the Profile and inside no
  Profile descendant, so Portable Export, Board records, snapshots, and Profile
  recovery never see it.
- **No plaintext or `chmod 600` fallback, ever.** This ADR rejected that
  fallback and the rejection is untouched. When the protected store is
  unavailable, for a locked keychain, a Linux box with no secret service, or an
  Electron build where encryption is unavailable, the desktop **fails closed to
  the pre-reversal behaviour**: no `offline_access` is requested, no refresh
  token is accepted, and the session lasts one access-token lifetime. An install
  that cannot protect a durable credential never asks Clerk to mint one.
- **No revocation endpoint, no durable credential.** If provider discovery does
  not publish `revocation_endpoint`, Eido requests the base scope and holds
  nothing. A refresh token that cannot be taken back is the JWT problem this
  epic already reversed once.
- **Two lifetime bounds, deliberately separate.** The access-token lifetime cap
  drops from 172,800 seconds to **7,200**; the 48-hour cap only ever existed
  because a long access token was the only way to last a working day, and that
  reason is gone. The local session identity is bounded separately at **30 days**
  without a successful renewal, matching
  `HOSTED_CAPABILITY_GRACE_DEFAULT_LOCAL_UNLOCK_SECONDS`. It is a fixed Eido
  ceiling, not read from the served grace policy, so no server-set value can
  lengthen how long this desktop presents an identity it has not reverified.
  Raising one number to cover both would silently accept a long-lived access
  token, which is a different and worse thing.
- **Destruction, not forgetting.** Sign-out revokes the refresh token at Clerk
  and removes it from the store, and it does so even when there is no live
  session, because a stored record outlives the process that wrote it. An
  account switch destroys and revokes the previous account's credential before
  writing the new one. An account the ADR 0046 saga has moved to
  `deletion-pending` gets no durable credential at all, because identity is
  removed last and a credential must not outlive the thing that revokes it.
- **A refusal ends the session once.** A refresh token the provider rejects is
  destroyed and the session ends cleanly as expired. It is never re-presented,
  as another grant or as a revocation. An **unreachable** provider is not a
  refusal: it changes nothing, keeps the credential, and keeps the session, which
  is the entire offline case.

### Scope: `offline_access` is requested, and the exact-match validator moves with it

The founder's Clerk OAuth application lists `email offline_access openid`, and
`offline_access` cannot be removed from it. That list does not decide anything on
its own: listing a scope permits requesting it, and an authorization request asks
for a subset that Clerk grants exactly.

So Eido chooses per sign-in. With a usable protected store and a published
revocation endpoint it requests `openid email offline_access`; otherwise it
requests `openid email`, exactly as before.

The trap is that `desktopAccountSession.ts` validates the granted scope by
**exact match** against what it requested. The two are now computed together and
threaded through the flow rather than read from a module constant. Sending one
scope and validating the other fails sign-in for every person, on the happy path,
with an opaque `authorization-failed`. Anyone changing the requested scope must
change the validator in the same edit.

The server side was verified against the live instance: `grant_types_supported`
includes `refresh_token`, `scopes_supported` includes `offline_access`, and the
discovery document publishes `revocation_endpoint`.

### What did not change

- The revocation staleness window stays 60 seconds. The control plane still
  verifies opaque access tokens through Clerk, and the durable credential does
  not extend how long a revoked person keeps working.
- Hosted spending still fails closed on the snapshot's short expiry. An offline
  desktop has no access token, so control-plane calls fail rather than succeed.
- The AI provider key stayed password-free local storage under this ADR as
  amended on 2026-08-19, and no longer does. **Amended 2026-08-27 (#1359):** the
  provider keys now use the same protected store, on the same terms, for the
  same reason the refresh token does. What #774 actually bought is kept by
  ordering rather than by abstinence. Every store reads its own file first and
  approaches the operating system only once it has found a secret to open, so
  the person who has only opened their Boards still meets no authorization
  sheet, and a store that will not open still degrades AI alone.

  What this costs, stated rather than implied: an install that does hold a
  provider key now reads the protected store on the launch that loads it, where
  before it read nothing. On a signed build accessing the keychain item it
  created, that read is silent. On a build whose signature does not match that
  item, it is an authorization sheet. Removing even that read means not loading
  the key until it is first used, which is a renderer change this amendment did
  not make.

  `electron/keychainNoPasswordPolicy.test.ts` enumerates every protected-storage
  consumer in `electron/`, pins the single binding in `electron/main.ts`, counts
  the three hand-offs of it, and asserts as behaviour that a Profile holding no
  credential approaches the store zero times.
- Startup still opens Boards with no account and no network (ADR 0039). Restore
  is fired and forgotten after the bridge exists, never awaited, and reaches the
  protected store only when a live record is actually on disk, so an install that
  never signed in never sees a system prompt.

### Known gap

A cold start with **no network at all** lands signed out. Restore renews through
the provider, and offline it cannot. The credential is kept for the next attempt
and nothing is lost, but recovery is **next launch, not next network**. Restore
fires exactly once at startup and nothing re-attempts it for the life of the
process, so a person who launches on a train and reaches wifi ten minutes later
stays signed out until they quit and relaunch, or sign in by hand. Retrying on
reconnection is worth building and is deliberately not in this change; it is
tracked separately.

A third gap is smaller and terminal. Rotation means a successful renewal kills
the token on disk the instant the provider answers, so between the grant
returning and the replacement being written there is a window in which the only
live credential exists nowhere but memory. That window is now one local file
write rather than a network round trip to a separate service, which is three or
four orders of magnitude less exposure, and it closes only for a hard process
death or a power loss. When it does happen the stored token is dead, the next
launch is signed out, and the cost is one manual sign-in. Making it recoverable
would mean a two-slot record holding the old token until the new one is proven,
which is real complexity for a failure measured in milliseconds against a cost
measured in one sign-in. Recorded so the next reader does not rediscover it as a
surprise, and deliberately not engineered around.

Carrying the last fresh entitled snapshot across a cold offline start is a
second, larger gap. It would need a persisted entitlement record, which is a
separate product decision about where entitlement authority lives, not a custody
question, and it belongs with #1037's presentation half. The scenario the
reversal does fix is the one that was reported: the app running, the lid closed,
offline for a month.
