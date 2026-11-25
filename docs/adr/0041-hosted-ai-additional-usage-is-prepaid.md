# ADR 0041: Hosted AI Additional Usage Is Prepaid

Status: superseded by ADR 0051 on 2026-10-27.

Historical decision. The founder removed this commercial architecture in [ADR 0051](0051-free-open-source-byok-only.md). Do not implement or operate it from this record.

## Context

The monthly Eido subscription includes up to US$5 of Hosted AI usage. Usage
beyond that amount could accumulate as a postpaid bill or require purchased
credit before Eido increases the OpenRouter-enforced allowance. Postpaid usage
would make Eido finance inference, absorb failed collections, and expose itself
to an unbounded gap between OpenRouter spend and customer payment.

The customer pays Eido one subscription transaction, US$15 per month before
applicable tax since 2026-08-19. The Included AI
Allowance is an internal product allocation; Stripe does not split that
transaction with OpenRouter. Eido separately maintains sufficient prepaid
OpenRouter account credit to serve aggregate customer allowances.

## Decision

Additional Hosted AI usage is prepaid AI Credit. When available allowance is
exhausted, Hosted AI pauses unless the customer manually purchases AI Credit or
has enabled Auto-Recharge. Eido increases the Hosted AI Credential's upstream
financial limit only after Stripe confirms the corresponding payment.

Exhausting paid allowance does not fall back to Free Hosted AI while the paid
entitlement and paid Funding Route remain current. Recovery is limited to
waiting for authoritative usage reconciliation, resolving a billing problem
when applicable, consuming or purchasing AI Credit only while its server policy
is enabled, or using BYOK. Eligibility for the free policy begins only after
the paid entitlement ends and a paid-to-free Route Transition completes.

The Included AI Allowance belongs to one customer's Stripe subscription
billing period. Any unused amount expires at the end of that period and a
successful renewal grants a fresh US$5 allowance; included usage never rolls
over. Eido's entitlement ledger owns this anniversary-based period even though
OpenRouter's documented monthly key reset follows the UTC calendar month. A
period cannot close by treating the latest provider observation as final: its
Provider Usage High-Water must be reconciled under the provider-finality launch
gate in **Hosted AI Is a Control Plane Over Direct OpenRouter Access** before
the old grant is released or a replacement grant can be
spent.

Stripe supplies the period boundary. Whether that boundary has passed is decided
by the clock of the database holding the ledger, never by the clock of the
container asking (amended 2026-08-20, issue #873). Because the allowance does
not roll over, the boundary is the instant unspent money stops being spendable,
and every replica asks about the same rows. A replica running behind would admit
spend from a period that had already closed; one running ahead would refuse, and
could permanently record as expired, value the customer paid for and cannot
recover. One clock answers it, and it is the clock that owns the rows.

That reading is taken at the moment the ledger acts on it, after it holds the
account it is about to charge, and never at the moment it began waiting for that
account. The two are not the same instant: a spend request can join the queue
inside the period and get its turn outside it, and answering from the earlier
instant spends closed-period money with every clock in the system correct.

Auto-Recharge is opt-in and defaults off. The customer chooses its trigger and
pack size and sets both a rolling charge-count limit and a subscription-period
gross-spend limit. The server enforces a one-attempt-in-flight invariant,
cooldown, threshold hysteresis, and stricter platform ceilings. A failed,
declined, or authentication-required payment is not automatically retried,
does not create debt or unlock usage, and pauses Auto-Recharge with a
recoverable explanation. Basic BYOK remains unaffected.

Purchased AI Credit is distinct from Included AI Allowance. A purchase expires
12 months after its payment succeeds and is consumed only after the active
billing period's Included AI Allowance. Cancellation preserves unexpired AI
Credit on the Eido Account, but Hosted AI and therefore use of that credit
requires an active subscription. Auto-Recharge cannot run while the
subscription is inactive.

The app shows the 12-month expiry before purchase and shows balance lots and
expiry dates afterward. Eido publishes a short refund window for an unused
accidental purchase and always applies any stronger consumer-law requirement.

Purchased AI Credit and Auto-Recharge are implemented behind server policy but
remain disabled in production until an Australian tax adviser and consumer
counsel approve the supply classification, GST recognition timing, redemption,
expiry, refund, dispute, invoice, and adjustment-note treatment. Current ATO
guidance can treat reloadable account funding as non-taxable when paid, with
GST arising on later supplies or forfeiture; Stripe's multi-purpose Gift Card
tax code is therefore not an assumed fit. The approved advice may change the
product from reloadable account credit to fixed usage packs without changing
the prepaid/no-debt boundary.

## Considered Options

- Chosen: prepaid additional usage, because payment precedes Eido's financial
  exposure and the upstream key remains a real hard stop.
- Not chosen: postpaid metered overages, because collection and fraud risk
  would sit with Eido after OpenRouter had already consumed Eido's funds.
- Not chosen: uncapped automatic charging, because an accidental loop or stolen
  credential could repeatedly charge the customer.
- Not chosen: automatic paid-to-free fallback at exhaustion, because it could
  route around the paid cap, overlap allowances, and misattribute delayed
  provider usage.

## Consequences

- Stripe payment state, Eido's entitlement ledger, OpenRouter key limits, and
  the shared OpenRouter balance require idempotent reconciliation.
- The key should use a cumulative upstream limit that Eido advances from its
  ledger, or another confirmed mechanism that avoids treating OpenRouter's UTC
  calendar reset as the customer's subscription anniversary.
- Concurrent in-flight requests may create a small documented overshoot; Eido
  must reserve margin rather than represent the cap as mathematically exact.
- Recharge consent, receipts, limits, payment recovery, refunds, and customer
  visibility are product requirements, not backend-only details.
- The ledger consumes expiring credit lots in earliest-expiry-first order and
  preserves purchase/refund provenance; it never collapses paid credit into
  the non-rolling monthly allowance.
- Late usage from a retired generation remains charged to that generation's
  immutable Funding Route; it cannot consume a later free allowance or renewed
  Included AI Allowance merely because it was observed later.
- Production policy must fail credit purchase and Auto-Recharge closed until
  the jurisdiction-specific professional sign-off is recorded.

## Amendment, 2026-08-23: one non-expiring Usage Balance replaces allowances and packs

The Included AI Allowance, expiring AI Credit, fixed pack catalog, free funding
route, and paid-to-free allowance transition above are superseded.

There are no paying customers at this prelaunch cutover. The implementation
removes those old product behaviors instead of preserving dual pricing,
allowance, expiry, pack, or free-route paths. Persistence migration remains
safe and explicit, but obsolete product behavior and compatibility aliases are
deleted rather than carried into launch.

Persisted Included Allowance rows are the narrow exception for historical
decode: they may still be projected for audit/compatibility, but are inert.
They cannot fund reservation admission or replay, credential delivery,
provider-usage attribution, provider caps, or period-finality blocking, and
current ledger maintenance does not expire or otherwise reinterpret them.
Legacy `hosted-free` wire and provenance values remain readable without an
installed renderer-facing Free execution authority or route.

Eido Plus costs US$5 per month before applicable tax and includes zero usage
credit. Initial Stripe Checkout also purchases a user-selected US$5–US$1,000
Usage Balance amount. That amount is credited in full and is separate from the
Plus fee. One non-expiring balance funds both Eido-managed OpenRouter and
managed Linkup Web Mode at measured provider cost with no Eido markup.

The mandatory US$5–US$1,000 balance purchase applies only to first activation.
A returning subscriber pays the recurring US$5 Plus price, keeps the existing
balance, and resumes the saved Auto-Recharge setting without another forced
top-up.

Auto-Recharge remains an optional setting chosen during initial purchase. It
has no separate consent screen, consent copy, or repeated confirmation: the
person sets it and it remains in force until changed. The initial balance amount
becomes the recharge amount when enabled and can be changed later. Eido triggers
at US$1. Amounts through US$100 have a 10-minute automatic cooldown; amounts
above US$100 have a 30-minute cooldown. There is no monthly recharge-count or
gross-spend cap. Manual US$5–US$1,000 whole-dollar top-ups remain available
during cooldown and always use Stripe-hosted Checkout. One-attempt in-flight,
Stripe payment authority, idempotency, no-debt, and fail-closed provider
boundaries remain mandatory; those internal proofs do not become another user
flow.

After purchase, **Settings → Account** exposes the saved Auto-Recharge switch
and whole-dollar amount with one **Save** action. Turning it on or off or changing
the amount does not open Checkout or ask for payment confirmation again; the
saved value applies to the next automatic charge. This is deliberately a small,
set-and-forget setting rather than a separate billing workflow.

One failed automatic payment pauses further attempts instead of creating a
blind retry loop. Eido shows a simple toast, records a content-blind failed
recharge in Account history, and links the person to Stripe Customer Portal.
Manual Top-Up remains available. When verified Stripe state confirms usable
payment details again, Eido automatically resumes the unchanged saved setting;
the person does not have to recreate it.

When an action encounters the US$1 threshold while Auto-Recharge is active,
Eido begins at most one automatic charge, shows **Adding balance…**, waits for
verified Stripe confirmation, and then continues the same original action
without another click. A cancelled, failed, or indeterminate payment stops the
action rather than treating the Checkout return or client state as money.

US$1 is a soft recharge and admission threshold, not an estimated action-cost
cap. Above it, Eido does not hold or deduct a conservative maximum before an
OpenRouter action. The per-user OpenRouter credential's upstream spending limit
remains the no-debt boundary; if it is exhausted mid-run, Eido retains any
partial result, settles only measured provider usage, and shows **Balance
empty**. A managed Linkup request has a known request price, so that exact
amount must be funded before the relay sends it.

When Auto-Recharge is enabled, at or below US$1 already-running managed work
may finish, but no new managed action begins until recharge is canonically
confirmed. When Auto-Recharge is disabled, the threshold does not gate
admission: managed usage may continue to zero with a soft low-balance notice.
Personal-key work is unaffected. This replaces the earlier conservative
reservation-margin rule; the product does not reject an action merely because
an estimate might exceed the current balance.

Confirmed provider cost remains authoritative even when it exceeds the last
available customer balance. Eido records the full actual cost, clamps Usage
Balance to zero, and absorbs the difference. It never creates customer debt or
rewrites the provider fact to fit the balance.

Account history presents every balance mutation as its own content-blind row:
initial purchase, Manual Top-Up, Auto-Recharge, managed usage, Managed Fallback,
or refund adjustment. Each row shows the exact monetary effect and resulting
Usage Balance. It never stores or displays a prompt, query, response, or result.

Initial balance purchases, Manual Top-Ups, and Auto-Recharges credit the exact
selected whole-dollar amount. Stripe calculates and charges any applicable tax
in addition to that amount; tax is never deducted from Usage Balance. Managed
usage is stored and settled at the provider's native monetary precision without
rounding each action upward. The Account surface uses ordinary two-decimal
currency for purchases and reveals up to six decimal places for small usage
amounts only when needed.

The product applies one fixed **Processing Fee** only when a transaction adds
Usage Balance: 10% of the selected balance or US$1, whichever is greater. The
selected balance is the fee base for first activation, Manual Top-Up, and
Auto-Recharge; first activation displays the US$5 Plus item plus that balance
plus one fee line. The fee itself and Stripe-added tax are excluded from the
calculation base. A Plus-only renewal or return has no Processing Fee. The
selected balance is still credited in full.

The person sees one Processing Fee, never separate OpenRouter and Stripe
components. It collectively funds managed-provider and payment operations; it
is a fixed commercial policy, not an exact pass-through or a markup on measured
usage. The accepted fee is final and is never reconciled to actual external
cost after purchase.

This rate never follows provider data automatically. The founder is responsible
for monitoring the external cost and making an explicit versioned server-policy
revision if it changes. Pricing never depends on a desktop release; installed
clients, including older supported versions, read current server authority.
Historical purchases retain the exact revision they accepted. Once paid, the
Processing Fee is non-refundable unless applicable consumer law requires
otherwise.

Eido calculates the fee in exact decimal arithmetic and rounds the final result
once to the nearest cent using standard half-up rounding.

A narrow founder-operated Operator Console owns explicit commercial-policy
changes and content-blind operational monitoring. It is a server administration
surface, not a general database editor or a dependency of desktop release
cadence.

OpenRouter automatically returns native token counts and its authoritative
`usage.cost` with each response, including the final event of a streaming
response. Each provider generation remains separately identified and
reconcilable by generation ID. Eido sums the confirmed costs of every managed
generation belonging to one user Run into one minimal **AI** history row; a Run
that entered through Managed Fallback adds only a small **Fallback** marker.

Eido always reflects confirmed provider spend, including tokens consumed before
a partial or failed stream ended. It never reconstructs customer cost from an
estimate when authoritative usage is missing. A missing final streaming event
leaves a minimal **AI · Pending** row while Eido retrieves or reconciles the
generation record; that row is replaced by the exact deduction only when the
provider fact is authoritative. Ambiguous cost is not guessed.

For each generation Eido durably retains only its opaque generation identity,
model slug, exact cost, and prompt, completion, reasoning, and cache token
counts. These content-blind facts support settlement and support diagnosis.
Prompts, responses, and tool content remain forbidden. The user-facing row is
the aggregated Run total rather than this backend breakdown.

OpenRouter sources for this accounting boundary:

- [Usage Accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)
- [Generation metadata API](https://openrouter.ai/docs/client-sdks/typescript/api-reference/generations)

Ending Plus pauses use without forfeiting the balance. Restarting Plus restores
use. The balance does not expire while the Eido Account exists. Refund requests
are handled manually by support in Stripe; Eido does not build a refund system.
Final account erasure waits until a positive balance is spent or manually
refunded.

Free uses BYOK and receives no Eido-funded provider usage of any kind. There is
no daily reset or free managed allowance. The shared provider-funds breaker,
durable monetary provenance, provider reconciliation, and professional
tax/consumer-law launch gates still apply to the replacement balance model.

## Amendment, 2026-08-26: Auto-Recharge is built and switched off in production

Everything this ADR decides about Auto-Recharge landed in epic #1212: the US$1
trigger, the US$5 to US$1,000 whole-dollar amount, the 10 and 30 minute
cooldown bands, the absence of a monthly count or spend cap, resuming the
original managed action after a verified charge, pausing after a failed charge,
and resuming the unchanged setting once Stripe confirms usable payment details.

**None of it runs in production.** Auto-Recharge is the one path in this system
that charges a saved card without the customer present, so it ships disabled
behind a gate that no configuration value can open. The gate is three
independent locks, in the order activation must happen: (a) the desktop client
validator in `electron/accountControlPlaneClient.ts` (`validateAutoRecharge`)
rejects an enabled production publication, so a desktop release relaxes it
first; (b) the server authority (`services/ai-control-plane/src/adapters/postgresAutoRechargeAuthority.ts`
and its sandbox-pinned reads and types) must accept production, a code change
plus release; (c) the deployed flag in the cloud composition stays off and is
the only policy switch. Every charging path is bound to it and fails closed.

Turning it on is a code change and a release, not a setting. It needs the
founder's decision and is tracked in
[#1302](https://github.com/limweili/eido/issues/1302).

While it is off, a customer with an exhausted balance is not stuck: Manual
Top-Up is always available, and managed usage stops at zero rather than
creating debt. The two presentation pieces this ADR implies, the progress
moment during a recharge and the soft low-balance notice at line 192, are also
unbuilt and tracked in
[#1295](https://github.com/limweili/eido/issues/1295). Correctness does not
depend on either.

## Amendment, 2026-09-04: the deployed flag is the production switch

Issue #1302 removes the hardcoded production check described above.
`autoRecharge.enabled` now controls the published launch gate in both sandbox
and production. The trigger reads that publication before every charge and
still refuses with `production-launch-gate` when the gate is closed or cannot
be read.

Both shipped compositions set `autoRecharge.enabled` to `false`. Runtime
configuration has no environment variable for it. Turning Auto-Recharge on
therefore remains a founder decision, a code change, and a release. Issue
#1302 prepares the switch but does not activate it.
