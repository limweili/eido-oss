# ADR 0043: Stripe Is Billing Authority; Entitlements Are Eido Projections

Status: superseded by ADR 0051 on 2026-10-27.

Historical decision. The founder removed this commercial architecture in [ADR 0051](0051-free-open-source-byok-only.md). Do not implement or operate it from this record.

## Context

The desktop cannot safely infer paid access from checkout redirects, cached
flags, or customer claims. Subscription renewal, cancellation, disputes,
refunds, tax, payment authentication, and out-of-order webhook delivery all
change what has actually been purchased. Yet Stripe objects are payment
mechanics rather than Eido's product language and should not spread into every
feature gate.

## Decision

Stripe is the authority for money movement, subscription state, invoices,
payment methods, and applicable tax. The AI Control Plane verifies and
records Stripe webhook events in an idempotent inbox, refetches canonical
Stripe objects, and reduces them into an Eido-owned entitlement and credit
ledger. Event order is not authority. A periodic reconciliation closes webhook
gaps. The desktop reads that signed-in account projection and never grants
access merely because Checkout returned successfully.

Initial purchase and management use Stripe-hosted Checkout and the Stripe
Customer Portal in the system browser. The recurring offer is presented as
US$15 per month before applicable tax (amended 2026-08-19; originally US$10).
Australia is the first and only enabled
sales country; when GST applies, every Australian consumer offer gives the
tax-inclusive single total at least equal prominence to the base-price
breakdown. The exact total is calculated before confirmation. Voluntary
cancellation takes effect at the paid period end. A previously paid
subscription's first failed or action-required renewal enters a 72-hour Eido
Billing Grace with Auto-Recharge disabled; initial payment failure receives no
grace. Stripe's invoice-finalization grace and Smart Retry schedule do not
define Eido access.

Paid Hosted AI activates only when canonical evidence shows the relevant
invoice paid and its subscription active. Each paid invoice grants its
Included AI Allowance exactly once. A dispute creates an immediate risk hold;
refund and recovery behavior is append-only and reconciled. Cancellation
makes the account eligible for the then-current free Hosted AI policy after
period end, but free admission begins only after the paid entitlement closes
and the reconciled, no-overlap paid-to-free Route Transition in **Hosted AI Is
a Control Plane Over Direct OpenRouter Access**
completes. Cancellation never relabels a paid credential generation. Local work
and basic BYOK remain available throughout.

## Considered Options

- Chosen: Stripe-hosted payment surfaces plus an Eido entitlement projection,
  minimizing payment-data scope while keeping product semantics local.
- Not chosen: trusting a desktop success URL, because it is forgeable and does
  not settle asynchronous payment state.
- Not chosen: gating features directly on raw Stripe status strings, because
  billing mechanics and Eido product access evolve independently.

## Consequences

- Webhook signature verification, event deduplication, out-of-order reduction,
  replay, reconciliation, refunds, disputes, tax location, and sandbox/live
  separation are first-class control-plane responsibilities.
- Exactly one Stripe Customer is mapped to an Eido Account by opaque internal
  identity, never by email. The desktop submits product intent; server policy
  selects Price IDs, amounts, return URLs, tax behavior, and country eligibility.
- Eido remains the seller and merchant of record. Stripe Tax assists with
  calculation and records but does not authorize a country, choose Eido's legal
  classification, or assume remittance and consumer-law responsibility.
- The one-time advanced-AI entitlement is compatible with this boundary but is
  roadmap-only and outside the current implementation epic.
- Local Boards and basic BYOK remain available during Stripe, Clerk, or Eido
  service failure.

## Amendment, 2026-08-19: the recurring offer is US$15 per month

Founder decision. The recurring Hosted AI offer changes from US$10 per month
before applicable tax to **US$15 per month before applicable tax**.

### The split

| Part | Amount | What it is |
| --- | --- | --- |
| Included AI Allowance | US$5.00 | The subscriber's hosted AI spend for the period. Unchanged. |
| Eido margin | US$10.00 | Everything else the subscription buys. Was US$5.00. |

The Included AI Allowance is untouched at US$5.00 per successful subscription
period (`includedAllowanceMicros: 5_000_000`). Only Eido's margin doubles.

### Rationale

The earlier US$10 price left US$5 of margin against a US$5 allowance, so half
of every subscription funded inference. The subscription now also unlocks web
mode, research mode, the Linkup key field, the `eido` CLI, and local AI
harnesses as providers (**Hosted AI Monetizes Convenience While Basic BYOK
Remains Free** amendment, 2026-08-19). Those capabilities are
what the subscription sells; the allowance is a convenience inside it. US$15
prices the capability set rather than the inference, and leaves headroom for
the allowance to grow without a second repricing.

### What this does not change

The split is an internal margin decision, not a billing artefact. Stripe sees
**one Product and one flat licensed recurring Price of US$15.00 per month**. It
does not see the US$5/US$10 division, and Eido's own entitlement ledger remains
the authority for allowance grant, burn, and expiry. Stripe Billing Credits
cannot model the allowance, because credit grants apply only to metered prices
reporting through Meters and never to a licensed price
(https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits).

Tax posture is unchanged and still pending professional review. The Price keeps
`tax_behavior: exclusive`, Australia remains the only enabled sales country,
and where GST applies the tax-inclusive total (US$16.50 at 10%) keeps at least
equal prominence to the US$15.00 base-price breakdown.

### Single source of truth

`HOSTED_AI_MONTHLY_UNIT_AMOUNT_MINOR` in
`services/ai-control-plane/src/domain/subscriptionBilling.ts` is the one place
the headline amount is written in code.

Two separate things read it, and they must not drift:

- **What Stripe charges.** The Checkout path checks the live Price and the
  offer it hands to Stripe against the constant, and canonical invoice proof
  checks the billed subtotal. A Price that disagrees with today's code is
  therefore never sold. Canonical subscription reads may still report a
  retired historical Price with a different commercial shape so Tier
  resolution can withhold access and alert; reading provider history is not
  permission to charge it again.
- **What the customer sees.** The Hosted Product Policy's published offer
  derives `exclusiveAmountMinor` from the same constant and its GST-inclusive
  total from `australianGstInclusiveMinor`, rather than carrying its own
  literals. Before this, the displayed price and the charged price were
  independent literals in two files and nothing compared them, so an edit to
  one alone would have displayed one price while charging another.

## Amendment, 2026-08-23: Stripe owns the purchase and management surfaces

This amendment supersedes the US$15 price and Included AI Allowance described
above. Eido Plus is **US$5 per month before applicable tax** and includes zero
usage credit. Its first purchase also includes one mandatory, user-selected
Usage Balance purchase from US$5 through US$1,000. The selected amount is
credited in full; tax is never deducted from Usage Balance.

That mandatory balance line belongs only to the first Plus activation. A person
who later resubscribes pays the US$5 subscription price without a second forced
balance purchase; the preserved balance and saved Auto-Recharge setting resume.

**Eido does not build a checkout screen.** Its pre-Checkout control shows one
minimal itemised summary with short labels: **Plus — US$5**, **Balance — US$X**,
**Processing Fee — US$Y**, and **Total**. The first row is Eido's recurring
revenue; the second is the person's selected initial/recharge amount credited
in full; the third is the fixed commercial fee for a balance purchase. The
total is pre-tax. Pressing it creates a Stripe-hosted
Checkout Session and leaves payment details, the authoritative order summary,
applicable tax, authentication, local payment methods, and receipt creation to
Stripe.

The primary action may say **Try Plus**, but it is not a trial. The disclosed
summary appears before leaving Eido and no Plus or managed usage is granted
until the paid Stripe purchase becomes canonical.

Checkout eligibility is also canonical and is projected per Account. The
server publishes `first-activation` for a fresh `none` projection and for a
fresh ended record with a recognized non-Plus Tier; both require the mandatory
initial Usage Balance. It publishes `plus-return` only for a fresh ended
entitlement whose historical/current Tier key is exactly `plus`, and
`balance-top-up` for an active or canceling Plus period. Null, unresolved, or
stale ended records publish no purchase eligibility and are refused before
Checkout. The desktop consumes this one server field for Account actions,
capability hints, and the upgrade modal; it never derives eligibility from a
global Checkout-composed flag. On-demand canonical freshness recovery is a
follow-up dependency owned by #1228; periodic reconciliation alone is not the
intended user recovery path.

The Account wire is an intentional prelaunch hard cutover: the quote-policy
`checkoutEligibility` binding is required. An older desktop that does not
understand the key fails closed instead of showing retired commerce. The
matching control-plane and desktop builds must ship together before the
replacement Checkout adapter is enabled; compatibility parsing is not part of
this commercial boundary.

A cancelled or failed Checkout returns to the purchase surface as **Payment
incomplete**. The redirect itself never grants Plus, credits Usage Balance, or
saves Auto-Recharge state; only verified Stripe events and canonical
reconciliation can do so.

The Checkout Session uses subscription mode with three distinct line items:
the recurring US$5 Plus Price plus one-time initial Usage Balance and Processing
Fee Prices on the first invoice. Stripe explicitly supports recurring and
one-time line items in one subscription-mode Session, with one-time Prices
appearing only on the initial invoice. Eido grants neither Plus nor Usage
Balance from the redirect; verified Stripe events and canonical reconciliation
remain the authority.

**Eido does not build subscription-management, payment-method, invoice, receipt,
or cancellation interfaces.** A single control opens a temporary Stripe
Customer Portal session in the system browser. Stripe's portal owns billing
details, payment methods, current and past invoices, receipts, subscription
status, and cancellation. Eido reflects the resulting canonical Stripe state
through its existing projection after verified webhooks or reconciliation.

Settings → Account remains deliberately small. It shows current Tier, current
Usage Balance, concise content-blind balance history, a purchase/top-up action,
and the link to Stripe's Customer Portal. History labels are one or two words,
tooltips are two or three words, and any description is at most one sentence.
Every balance-changing initial purchase, top-up, recharge, managed usage,
Managed Fallback, or refund adjustment has one row with its exact amount and
resulting balance. Rows may also show time, provider, model or operation type;
prompts, queries, responses, and results are forbidden.

Initial balance, Manual Top-Up, and Auto-Recharge amounts are whole US dollars
from US$5 through US$1,000. Every deliberate Manual Top-Up opens a new
Stripe-hosted Checkout Session; Eido never performs an immediate saved-card
charge for that action. Using Manual Top-Up does not alter the saved
Auto-Recharge setting or the Plus subscription dates.

For every later Manual Top-Up or Auto-Recharge, Stripe adds applicable tax on
top of the selected amount. Eido credits the whole selected amount and never
funds tax from Usage Balance. Provider usage is settled at provider-native
precision without a per-action round-up; history may show up to six decimal
places when the exact amount is smaller than ordinary cent precision.

Every transaction that purchases Usage Balance also has one fixed Processing
Fee: 10% of the selected Usage Balance or US$1, whichever is greater. The fee
applies only when Usage Balance is added, so first activation displays the US$5
Plus item plus the selected balance plus one fee line; Manual Top-Up and
Auto-Recharge display the selected balance plus one fee line. The Plus item is
never part of the fee base. Stripe adds applicable tax later, and the fee and
that Stripe-added tax are excluded from the fee calculation. A Plus-only
renewal or return has no Processing Fee. Exact decimal arithmetic is rounded
once to cents using half-up rounding.

The person sees only the resulting Processing Fee, not separate OpenRouter or
Stripe components. The fee is a fixed commercial charge that collectively funds
managed-provider and payment operations; it is not represented as exact external
cost and is never reconciled after purchase. The accepted server policy revision
is stored with the purchase, so later founder changes never rewrite historical
payment facts.

Current pricing and fee policy are served by the AI Control Plane and managed
through a narrow founder-only Operator Console. A supported old desktop therefore
cannot freeze or override pricing; it must obtain current server authority before
showing the purchase summary or creating Checkout.

The Processing Fee is non-refundable once paid unless applicable consumer law
requires otherwise. A manual refund of unused Usage Balance does not silently
refund the fee.

A failed Auto-Recharge pauses further automatic attempts. Eido shows a simple
toast and content-blind history row, while Stripe Customer Portal remains the
repair surface. Manual Top-Up stays available. Verified Stripe state confirming
usable payment details automatically resumes the unchanged saved setting; Eido
does not repeatedly charge a known-failing method or ask the person to configure
Auto-Recharge again.

Account deletion remains a rare, subordinate action rather than a billing
surface. It freezes access immediately, but a positive Usage Balance prevents
final erasure until it is spent or support performs a manual Stripe refund.
Refund tooling is not recreated in Eido.

Voluntary cancellation in Stripe Customer Portal takes effect at the end of
the already-paid subscription period. Eido-managed access remains current
through that boundary and then pauses; cancellation does not rewrite the
original subscription dates.

A failed renewal enters the existing 72-hour Billing Grace. Existing Usage
Balance remains spendable during grace, while Auto-Recharge is paused. Stripe,
not an Eido payment scheduler, owns exactly one configured retry one day after
the failed attempt where the payment method and decline permit retry. Eido
observes Stripe's invoice attempt and `next_payment_attempt` facts; it does not
create a second PaymentIntent or replacement subscription.

The retry never resets the billing-cycle anchor. A recovered invoice restores
ordinary access against the original subscription dates. If it remains unpaid
when Eido's 72-hour grace ends, managed access pauses. Stripe documents that
hard declines and missing payment methods may prevent a scheduled retry from
executing; Customer Portal remains the route for the person to repair payment
details.

The deletion control sits behind a secondary **More** action at the bottom of
Settings → Account and requires two-step confirmation. It is not promoted in
ordinary account or billing flows. When a positive Usage Balance blocks final
erasure, the flow shows the minimal support route needed to resolve it.

Stripe sources for this amendment:

- [Stripe Checkout](https://docs.stripe.com/payments/checkout)
- [Checkout Session line items](https://docs.stripe.com/api/checkout/sessions/create?lang=create_subscription)
- [Stripe Customer Portal](https://docs.stripe.com/customer-management)
- [Stripe subscription payment retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries)
