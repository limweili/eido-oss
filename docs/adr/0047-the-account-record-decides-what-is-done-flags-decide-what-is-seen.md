# ADR 0047: The Account Record Decides What Can Be Done; Flags Decide What Is Seen

Status: superseded by ADR 0051 on 2026-10-27.

Historical decision. The founder removed this commercial architecture in [ADR 0051](0051-free-open-source-byok-only.md). Do not implement or operate it from this record.

## Context

Eido sells one paid offer today: Hosted AI at US$15 per month (**Stripe Is
Billing Authority; Entitlements Are Eido Projections**), which unlocks six
capabilities (**Hosted AI Monetizes Convenience While Basic BYOK Remains
Free**, 2026-08-19 amendment). Two parts of
that arrangement were never written down. A founder session settled them.

The first is packaging. `projectCapabilities` in
`services/ai-control-plane/src/domain/hostedAccountSnapshot.ts` maps any
current paid subscription to every entry of `HOSTED_CAPABILITY_KEYS`, so the
rule "paid means everything" is a literal in the code. `HostedPlanFacts`
records whether a subscription is current (its state, `validThrough`,
`graceUntil`, `cancellationEffectiveAt`) and carries no identity of which
subscription was bought. Neither shape can express a second priced level, and
nothing said where the mapping from a level to its capabilities should live
once one exists.

The second is operator control. Issue #992 shipped a server-side PostHog
control surface, `services/ai-control-plane/src/adapters/postHogCapabilityOperatorControls.ts`.
It runs in the control plane only, sends the public project API key, an opaque
Eido account id as `distinct_id`, and the current Tier as inline
`person_properties.eido_tier`. It reads the two declared boolean controls:
`eido-capability-withhold-managed-openrouter` and
`eido-capability-withhold-managed-linkup`. Each can withhold only its own
managed route; neither can grant entitlement or affect local/BYOK access. The
surface caches nothing so a kill switch bites immediately, and each route's
failure posture is evaluated independently. The old additive grant path is
retired (issue #1088), and an unavailable or stale Tier is sent as `unknown`
rather than omitted so stored PostHog properties cannot target an account.

Product analytics is a separate PostHog use, running in the Electron main
process through `posthog-node` (`docs/codebase/INTEGRATIONS.md`). The renderer
imports PostHog nowhere. The two uses share a vendor and nothing else.

## Decision

**More than one priced level is a later possibility, not present work.**
Nothing below builds a second level. What these decisions protect is that
adding one later is ordinary work rather than an unwind: the word for a level
is reserved now, the mapping from level to capabilities gets one home that can
grow a row, and the served snapshot already carries capabilities as an open
per-key list rather than a single paid boolean.

**Eido's own database is the sole authority on what a person bought and on
what that purchase unlocks.** Stripe notifies the database by webhook, the
database updates the account, and the application then tells PostHog who the
person is and which level they are on. At the moment a capability is decided,
neither Stripe nor PostHog is consulted. The level-to-capability mapping is
Eido's data as well: versioned server-side policy beside the rest of the
product policy, never a Stripe product-metadata field, never a literal in a
shipped build, and never a PostHog flag.

This refines **Stripe Is Billing Authority; Entitlements Are Eido
Projections**; it does not reverse it. Stripe remains the authority
for money movement, subscription state, invoices, payment methods, and
applicable tax, and Eido's record of what was bought is still derived from
Stripe by verified webhook plus periodic reconciliation, exactly as **Stripe Is
Billing Authority; Entitlements Are Eido Projections** describes. The addition
is about the read side. That decision already forbade the
desktop from granting access because Checkout returned; this ADR extends the
same rule to every decision path and to every vendor, so a capability decision
reads Eido's own record and nothing else. Stripe is where the truth comes
from. Eido's record is what gets asked.

**The priced level and rollout audience are supplied to PostHog as person
properties, inline on every flag call and never stored on the person.** Flags
can then be targeted by exact `eido_tier` and `audience` conditions plus the
supported percentage dial; cohorts are not supported, and no release must ship
to change targeting, which is the whole reason for sending these facts at all.

Where the level lives is the part that matters, and research after the session
settled it. PostHog's `/flags` endpoint reads stored person properties by
default, but a call that supplies `person_properties` inline evaluates against
the supplied value for **each name it supplies**, in preference to any stored
value of that name. Eido supplies the Tier on every call and never syncs it
into PostHog as stored data. Two conditions come with that and are binding:
every property key a flag's release conditions read must be supplied on the
call, and cohorts may not be used, because a cohort resolves against stored
data. The cost is a few lines on a request body that already exists.

**Both halves of that were measured on 2026-08-20, and the second half is
narrower than this ADR first claimed.** An earlier version of this paragraph
said a call supplying `person_properties` "skips stored person data entirely".
It does not. The override is per property name: a condition reading a name that
is absent from the supplied object still resolves against stored person data.
That is why the two binding conditions above are load-bearing rather than
belt-and-braces, and it is the whole reason the reconciliation job that enforces
them has to be in place before any property-targeted flag is configured. It is a
prerequisite for that configuration, not a fix for a defect in shipping access
control. See the amendment of 2026-08-20 below and
`docs/monetization/posthog-property-proof.md`.

This is not a smaller version of what was decided; it is the only safe version.
Stored person properties are attacker-writable and supplied ones are not. A
PostHog project API key is public by design and ships inside Eido for product
analytics, and PostHog says plainly that anyone holding it can send spoofed
events under any `distinct_id`. `$set` replaces stored person properties, last
ingested wins, so one forged event can overwrite a stored Tier.
`$merge_dangerously` is callable with the same public key, is irreversible, has
no safeguards, and lets the surviving person's properties win, which makes it a
privilege-escalation path rather than a nuisance. Storing the Tier and
targeting flags on it would have put a value a third party can write in front
of a decision about what a customer sees. Supplied inline, the value comes from
Eido's own record on the same call that asks the question, and the forged-event
path reaches nothing.

Two costs remain and are accepted. Both are written here so that a later reader
can weigh them again rather than rediscover them.

1. PostHog is told what a named account pays for. Sending the Tier inline
   narrows this from a durable record inside an analytics vendor to a value on
   each flag request. That is a real reduction and not an elimination: it is
   still customer commercial data leaving Eido, joined to an account id, and it
   belongs in the privacy statement of record. It also runs against the posture
   of Eido's other PostHog use, which deliberately never calls `identify` and
   sets `$process_person_profile: false`. The two uses now differ on identity by
   design. That is a fact about the data, not a reason to split PostHog
   projects: PostHog is built for flags and analytics to share one project,
   which is what lets insights and replays be filtered by flag value, and its
   multiple-project feature separates environments rather than separating flags
   from analytics.
2. A targeting mistake made in the dashboard reaches real customers with no
   pull request, no test, and no reviewer in between. Reduce-only is what
   bounds the damage: the worst reachable outcome is a paying subscriber
   losing something they bought, or an unpaid person seeing a locked upsell.
   Neither can hand out unpaid access.

What the inline fix does not close is disclosure. A project key holder can
still ask the flags endpoint about any account id they can name and learn
whether that account is being withheld a capability. Control is closed;
reading is not. That is why account ids sent as `distinct_id` have to be
opaque, and why the finding stays recorded in `docs/codebase/CONCERNS.md`.

**PostHog decides what a person sees; the database decides what a person can
do.** That is the founder's framing and it is the rule. It needs one amendment,
established in the same session, because Eido is a local-first desktop
application: the rule holds cleanly only where an action reaches Eido's
servers. `funded-allowance` is genuinely server-gated, because Eido holds the
OpenRouter credential and a modified client still has no key. `web-mode`,
`research-mode`, `linkup-key`, `eido-cli`, and `local-harness` execute on the
person's own machine under the person's own credentials, so the gate is a
check on that machine and a determined owner can defeat it. This is not a new
exposure. It is the threat model this codebase already accepts and already
writes down: the 2026-08-19 amendment to **Hosted AI Monetizes Convenience
While Basic BYOK Remains Free** divides gates into "real gates"
and "signs" and says Eido will not spend effort on anti-tamper machinery, and
`docs/monetization/README.md` repeats it in the launch policy. The database's
answer stays the only correct answer, and an unmodified client obeys it.

**There are exactly two things this system knows about a person's level: free
and paid.** Free is the default the moment an Eido Account is created, and it
never involves Stripe. Paid is a Stripe subscription. Nothing else exists, and
in particular there is no third state for an account the founder decided not to
charge.

**`eido-capability-grant` is retired.** Handing out access by dashboard boolean
created a second way to be entitled: invisible to billing, absent from revenue
reporting, naming no level, and needing to be remembered by every later feature.
After the removal, entitlement comes from a Stripe subscription or it does not
exist.

**A discount is a Stripe arrangement and the product has no part in it.** When
the founder wants to give a friend, an early adopter, or a reviewer the paid
experience at no charge, they apply a discount to an ordinary subscription in
Stripe, by hand. The subscription is created and billed exactly like any other,
the invoice arrives through the ordinary paid path, the webhook fires, the
database learns it, and the entitlement projection reduces it. From that point
on nothing downstream can tell that subscription apart from one someone paid
full price for, because there is nothing to tell it apart by.

**The code must not be able to distinguish a discounted subscription from an
undiscounted one, and that is the decision rather than an omission.** Nothing
reads a coupon, a promotion code, a discount, or a discount total. Nothing
records, counts, displays, or branches on whether a discount was applied. Any
field, flag, or report that made a discounted account identifiable inside Eido
would recreate the very thing retiring the grant flag removed: a second kind of
paid account that every later feature has to handle. Whoever finds this absence
and reads it as a gap should read this paragraph instead. Discounts are the
billing system's business, and the founder answers questions about who is
discounted and what that costs in Stripe, where the discount lives.

**A fully discounted invoice is still a paid invoice, and that is why this
needs no code.** This is a real property of the money path and worth naming
precisely. The canonical-invoice gate in
`services/ai-control-plane/src/adapters/stripeProductionAdapter.ts` compares
`invoice.subtotal` against the expected amount, Stripe computes subtotal before
discounts are applied, and nothing in that check compares how much money
actually arrived. A discount therefore leaves the one number the gate reads
untouched. **Stripe Is Billing Authority; Entitlements Are Eido Projections**
grants the Included AI Allowance exactly once per paid
invoice, so a fully discounted subscription gets its Tier's allowance on the
ordinary path with nothing written to send it there. This was verified against
the code. It rests on a third party's arithmetic, so it is worth a test that
says so.

Retiring the grant flag is a removal with consequences, not a tidy-up, because
that flag shipped under #992. What is lost is speed and reach: a discount is a
Stripe action rather than a dashboard toggle, and it needs a Stripe customer to
exist, so a person who has never reached Checkout has to be walked through
Checkout or set up in the Stripe dashboard first. What is gained is that every
entitled account got there one way.

The consequence for the whole design is larger than the flag. With the grant
gone, PostHog becomes purely reduce-only over entitlement. A flag may withhold
a capability, or reveal a locked upsell, and it may never unlock anything.

**A flag may show a person a capability they have not paid for, as a locked
upsell.** The capability renders in the locked control state with its upgrade
path (`docs/design/design-system/SYSTEM.md` section 7; issues #989 and #990),
and the database still refuses the action behind it. This is deliberate: it
lets upsell placement be tested without a release. It also extends the design
system's existing "greyed, never hidden" rule from capabilities the product
already offers to capabilities it is deciding whether to offer here.

UI flags reveal; they never unlock. A reveal must therefore be expressed on
the interface surface, as "show this locked control", and never as an addition
to the capability entries in the served snapshot. A reveal flag that wrote
`state: 'available'` would be the one input in the system that widens access,
which is precisely the property #992 built structurally
(`applyCapabilityOperatorControls` can only ever write a state lower than
`available`).

**Naming.** `tier` is reserved for priced levels, in code, copy, dashboards,
and documentation.

- The AI model property `HostedCatalogModel.tier: 'free' | 'paid'` in
  `services/ai-control-plane/src/domain/hostedProductPolicy.ts` should be named
  `fundingRoute`. It never meant a priced level. It says which Hosted AI
  catalog a model belongs to, which is the same free/paid division `CONTEXT.md`
  already calls the **Funding Route**, so the name adopts a term the glossary
  defines rather than inventing one, and the codebase already carries it:
  `HostedFundingRoute` in
  `services/ai-control-plane/src/domain/hostedSpendLedger.ts` is
  `'hosted-free' | 'hosted-paid'`. The renamed field takes those two values
  rather than `'free'` and `'paid'`, so one idea keeps one vocabulary instead
  of growing a second. Bare `route` was rejected because it collides with HTTP
  routing inside a service; `access` and `catalog` were rejected as vaguer than
  the defined term, and `catalog` reads badly on a field that already sits
  inside a catalog.
- `plan` keeps its existing execution meaning from `CONTEXT.md`, an Execution
  Plan (ADR 0011, ADR 0013), and is not reused for pricing.
- `HostedPlanFacts` and the snapshot's `plan` section borrow `plan` in the
  subscription sense and should eventually be named for a subscription instead.
- **Neither rename is scheduled here, and both are blocked by the same thing.**
  Field names on the served snapshot are matched exactly by a validator that
  ships inside every installed desktop copy. `validModels` in
  `src/desktop/hostedAccountPresentation.ts` compares `model?.tier === tier`,
  so renaming that field server-side makes the comparison read `undefined`,
  every model fails validation, and an already-installed build discards the
  response. The `plan` section is read the same way. Bumping the snapshot
  schema version is not an escape hatch, because the desktop pins the number
  too: the same file rejects anything whose `schemaVersion` is not exactly `3`.
  Both renames therefore need a wire-compatible path, such as serving the old
  and new field names together until installed builds that read the old one are
  gone. Until one exists, `tier` has its reserved product meaning everywhere
  except these two shapes, and that gap is documented rather than closed. An
  earlier draft of this ADR called the model rename cheap and said it could
  ride the policy's own version. That was wrong, and acting on it would have
  shipped a release that broke existing installs.

**2026-08-20 amendment (issue #1079): the model rename has landed.** The
premise above, that a rename breaks an already-installed build, holds only
while an installed build can reach the control plane.
`docs/monetization/pricing-tier-spec.md` section C established that none can:
reaching it needs an issuer, a client id, and a control plane origin, no
packaging workflow injects any of the three, and the live identity provider
has no OAuth application, so the population of installed clients bound by this
wire contract is zero. `HostedCatalogModel` therefore carries
`fundingRoute: 'hosted-free' | 'hosted-paid'` outright, moved on the server, in
the Electron main validator, and in the renderer's model filter in one merge,
with no alias left for the old name. **This escape hatch is temporary.** It
closes on the first published build that carries all three settings against a
live OAuth application, after which section C's three release expand and
contract is the only safe shape.

**2026-08-20 amendment (issue #1084): the subscription section rename has
landed.** The four window conditions in section C were re-checked and all four
still held, so this rename took the same single merge shape. `HostedPlanFacts`
is now `HostedSubscriptionFacts`, `HostedPlanState` is
`HostedSubscriptionState`, `HostedPlanProjection` is
`HostedSubscriptionProjection`, the served snapshot's `plan` section is
`subscription`, and its copy identifiers are `hosted-subscription-*`. The
Electron main exact key set, the renderer's reader, and the renderer's own
message identifiers moved in the same merge, with no alias left for the old
name anywhere on the server, the wire, or the desktop. The snapshot schema
version stays `3`: both sides pin it by equality, so a bump distinguishes
nothing while the installed population is zero. The desktop's half is pinned by
`electron/hostedSnapshotSubscriptionSectionWire.test.ts`, which writes its keys
and values literally and imports nothing from the control plane. `plan` now
means only an Execution Plan, everywhere.

## Considered Options

- Chosen: Eido's own record holds both the account's tier and the
  tier-to-capability mapping, and is the only thing consulted when a capability
  is decided.
- Not chosen: the mapping in Stripe product metadata, because it makes a
  payments vendor's catalog the definition of Eido's feature set, puts a
  product change behind a Stripe edit with no review, and needs a Stripe read
  (or a cache of one) on a path that must work when Stripe does not.
- Not chosen: the mapping in Eido's shipped code, because a packaging change
  then needs a service release and, worse, a desktop release, and because that
  is the shape being replaced: `projectCapabilities` hardcodes "paid means
  everything" today. Versioned server-side policy is the established pattern
  (`docs/monetization/README.md`).
- Not chosen: the mapping in PostHog, because it makes an analytics dashboard
  the definition of what is sold, with no review and no history, and because it
  would make access depend on a service whose every failure is currently
  designed to be neutral.
- Not chosen: keeping the level out of PostHog and applying level targeting in
  Eido's code, because every targeting question ("offer this to subscribers
  first") then costs a code change and a release, which removes the reason the
  flag surface exists at all. The disclosure and no-review costs are accepted
  instead, above.
- Not chosen: storing the Tier on the PostHog person and targeting flags
  against stored data, which is the obvious way to do this and is unsafe. The
  public project key ships inside Eido, `$set` replaces stored person
  properties with last-ingested-wins, and `/flags` reads stored properties by
  default, so a forged event could move an account into or out of a targeted
  cohort. Supplying the Tier inline on each call reaches the same dashboard
  targeting without that exposure.
- Not chosen: disabling client-side evaluation for the capability flags. This
  is the answer a careful reader lands on, and it does not hold, which is why
  it is recorded here rather than left to be rediscovered. PostHog separates
  client from server by sniffing the `User-Agent`, so a `curl` caller is
  treated as a server and is served server-only flags, and an undocumented
  `evaluation_runtime` field in the request body turns the filter off outright.
  Both are visible in PostHog's own source. It is hygiene, not a boundary, and
  must not be recorded as one.
- Not chosen: encrypted remote config. The exclusion is real and enforced in
  SQL, so those payloads genuinely do not come back from `/flags`. The shape is
  wrong: a remote config flag returns the same payload to every user and
  release conditions do not apply to it, so it cannot express a per-account
  capability decision.
- Not chosen: a reverse proxy in front of PostHog, which the vendor documents
  as ad-blocker evasion for data completeness. It may be worth having for that
  reason. It is not a security control and must not be recorded as one.
- Not chosen: keeping `eido-capability-grant`, because free access that exists
  only as a dashboard boolean is invisible to billing, absent from revenue
  reporting, names no level, and is a second way to be entitled that every
  later feature has to remember.
- Not chosen: a grant flag that names a level, such as
  `eido-capability-grant-<tier>`, because it fixes only the naming half. The
  account is still invisible to billing and is still a second entitlement path.
- Not chosen: showing a person only what they already have, because it makes
  the product look smaller than it is, removes the ability to test upsell
  placement without a release, and contradicts the locked-not-hidden rule
  already in the design system.
- Not chosen: a cap on how many accounts may be discounted, or on their total
  monthly allowance cost. The founder declined a cap and has since confirmed
  there is no limit and that the question is out of scope. Enforcing one would
  require Eido to know which subscriptions are discounted, which is exactly
  what this decision forbids.

## Consequences

- The `grant` half of #992 is deleted, not deprecated: the
  `eido-capability-grant` flag key, `CapabilityOperatorReading.granted`,
  `CapabilityGrantPolicy`, `DEFAULT_CAPABILITY_GRANT_POLICY`, the `grant` step
  inside `applyCapabilityOperatorControls`, the
  `EIDO_CAPABILITY_GRANT_INCLUDES_ALLOWANCE` environment variable in
  `services/ai-control-plane/src/deployment/composition.ts`, and their tests.
  After that removal the operator reading has one field and one direction.
- The pending founder decision recorded in `CapabilityGrantPolicy`
  (`services/ai-control-plane/src/domain/capabilityOperatorControls.ts`) is
  moot rather than answered. Its comment describes a documented default of the
  five local unlocks without the funded allowance, "because that one spends
  Eido's money", with the flip framed as a configuration change. There is no
  such choice to make. A paid subscription carries its Tier's Included AI
  Allowance, and a discount applied in Stripe does not change what the
  subscription is. The comment and the
  `EIDO_CAPABILITY_GRANT_INCLUDES_ALLOWANCE` switch it describes go away with
  the rest of the grant path, and whatever replaces that text must not leave a
  question looking open where there is none.
- **The cost of discounted subscriptions is watched in Stripe, not in Eido.**
  A discounted subscription still draws its Included AI Allowance, so it still
  costs Eido money. That cost is real and the founder should watch it, but the
  place to watch it is Stripe, which knows exactly which subscriptions carry a
  discount and what each one is worth. Building a count inside Eido would mean
  teaching Eido to identify discounted accounts, which this decision forbids
  for good reasons that a reporting convenience does not outweigh.
- **Answered by the founder, 2026-08-20.** An earlier draft of this ADR left an
  open question: at what number of discounted accounts, or at what total
  monthly cost, would Eido want to stop issuing them, and should that figure be
  enforced or watched? The answer is that there is no limit and the question is
  out of scope. It is not deferred and it is not awaiting a figure. Nobody
  should reopen it or build a threshold, an alert, or a refusal path against it.
- Something must decide which capabilities a level unlocks, and when this ADR
  was written that was a literal inside `projectCapabilities`, so "one level,
  everything" was the mapping and it was the thing a second level breaks.
  **Resolved by issue #1080.** The mapping is versioned server policy in
  `services/ai-control-plane/src/domain/hostedTierPolicy.ts`: one row per Tier
  declares the capability keys it unlocks, and adding a level is adding a row.
  A Tier that does not resolve unlocks nothing. **Resolved by issue #1082:** the
  entitlement projection resolves the live Stripe product/price pair through
  that policy, stores the Tier key on the Entitlement, and carries it through
  the versioned hosted subscription record. Legacy or undeclared null Tiers
  unlock nothing while an awaited startup backfill re-reads provider truth.
- The account id sent as `distinct_id` must be an opaque UUID. Flag state for a
  named account is readable by anyone holding the public project key, and a
  guessable or enumerable id turns that from a targeted lookup into something
  worth doing at scale. This is a requirement on the implementing work, not a
  preference.
- **Amended by issue #1091.** The original withhold path failed open on every
  vendor failure: an unreachable, rate-limited, quota-exhausted, partial, or
  unreadable PostHog answer withheld nothing. That was sound for a staged
  rollout and unsound for the kill switch the same flag represents. Production
  policy now declares each capability's failure posture as `open` or `closed`.
  A closed posture withholds only capabilities for which the incomplete answer
  supplied no definite per-flag result; flags that were definitely answered
  still keep their own result, and an explicit withholding is always retained.
  PostHog's per-flag `failed: true` marker is not a definite result even when
  the same object carries a boolean fallback. It therefore remains unanswered
  and activates a declared closed posture. The served snapshot distinguishes
  this unconfirmed withholding from a confirmed operator withholding, while
  bounded content-blind telemetry names the failure class. A deployment with
  no flag surface remains a deliberate neutral surface rather than pretending
  a vendor failed.
- PostHog now receives a commercial fact about a named account. The privacy
  statement, the product-analytics data boundary in
  `docs/codebase/INTEGRATIONS.md`, and the two integrations' differing identity
  postures all need to say so.
- The desktop offers upsell placements that a flag can move, so a locked
  control's presence is no longer purely a function of the account. Anything
  that reasons about "was this shown" needs the flag state to explain it.
- The two deferred renames are real work with a real prerequisite, not
  paperwork: a wire-compatible path has to exist before either can happen, and
  building one is the actual cost. Anyone picking up "rename `tier`" as a tidy
  task should read the naming section first.
- `tier` also appears inside the canvas label painter (`src/canvas/labelLayer.ts`)
  as a label priority tier. That is a local painting word with no product,
  account, or billing meaning, it never reaches copy or data, and it is not
  renamed. The reservation applies to product, account, and billing language.
- Offline capability grace (issue #995) is unaffected. Every operator reduction
  still happens server-side before a snapshot is served, so grace continues to
  carry forward a cached entry state and never re-derives capability state.
  Retiring the grant removes the only input that could ever have made a cached
  snapshot wider than the entitlement behind it.

## Amendment, 2026-08-20: a discount is not a domain concept

Recorded because the error it corrects was written into this ADR, copied into
`docs/monetization/pricing-tier-spec.md`, `docs/monetization/README.md`,
`CONTEXT.md`, three code comments, and three tickets before anyone caught it. A
reader who finds the older wording quoted somewhere should know it was wrong
rather than merely superseded.

**The error.** Earlier drafts treated a "Comp" as a thing the product knows
about: a named entity in the glossary, an account state with its own user
stories, a paid amount recorded so that a discounted invoice would be
"distinguishable from a paid one in Eido's own data", and a reporting surface
counting how many existed and what they cost. That is a third level sitting
between free and paid, built out of a billing arrangement that has no business
being in the product at all.

**What is actually true.** Eido knows two levels. Free is the default the
moment an account is created and never involves Stripe. Paid is a Stripe
subscription. A discount is something the founder applies in Stripe, by hand,
to an ordinary subscription. The subscription that results is a paid
subscription in every respect, and the code must not be able to tell it apart
from one bought at full price. That indistinguishability is the design. It is
what stops a second class of paid account existing for every later feature to
remember, and it is why no field, flag, count, or report for discounts is a
missing piece.

**What survives the correction.** One fact, and it is the load-bearing one: a
fully discounted invoice is still a paid invoice, because the canonical-invoice
gate reads `invoice.subtotal`, Stripe computes subtotal before discounts, and
nothing checks how much money arrived. It was verified against the code and it
is correct. It is stated above as a property of the money path, deliberately
not as "how discounts are implemented", because the second phrasing invites
somebody to go and implement them.

**Named, so the old wording is findable.** "Comp", "comped account", and "the
Comp path" are retired. `CONTEXT.md` keeps a "Comp (not a domain term)" entry
saying so, because a term that must not be used needs somewhere to say it.

## Amendment, 2026-08-20: supplying properties inline overrides per name, not per call

Issue #1089. Record and complete output:
`docs/monetization/posthog-property-proof.md`.

This ADR's decision rests on two claims about how PostHog evaluates a flag.
Both were tested against the live project on 2026-08-20, in one run, with the
flags created and removed by the runner itself. One held. One did not.

**Held: a supplied property beats a stored property of the same name.** This is
the claim the whole inline mechanism depends on, and it is the reason storing
the Tier on the person was rejected. It is now measured rather than assumed.
The decision stands unchanged.

**Did not hold: that supplying `person_properties` takes stored person data out
of the evaluation.** An earlier version of the Decision section said such a call
"skips stored person data entirely". It does not. On a call that supplied one
property name and not another, a release condition reading the unsupplied name
matched against the value stored on the person and the flag returned enabled.
The override is per property name.

**What this changes in the decision: nothing.** What it changes is which
sentence carries the weight.

- The two binding conditions in the Decision section, that every property key a
  release condition reads must be supplied on the call and that cohorts may not
  be used, were correct. They are not defensive extras. They are the only thing
  standing between a dashboard edit and an evaluation against attacker-writable
  data, and this measurement is why.
- The second accepted cost above, that a targeting mistake reaches customers
  with no pull request and no reviewer, is now known to be slightly worse than
  written: the mistake can also read an input that never came from Eido at all.
  Stored person properties are writable by anyone holding the public project
  key, which ships inside Eido.
- The bound on that cost is unchanged and is structural, not a vendor property.
  No flag can widen access. The `eido-capability-grant` path was retired in
  #1088, and `reduceOnly` in
  `services/ai-control-plane/src/domain/capabilityOperatorControls.ts` serves a
  proposal only when it takes availability away from an entry the entitlement
  projection had made available. The worst reachable outcome is still a paying
  subscriber losing something they bought. That is the bound this ADR weighed
  and accepted, and it survives.

**What it changes in practice** is what detection is for. Nothing in Eido's
code can stop a flag being written in the dashboard, and the vendor's evaluation
does not contain one either, so the reconciliation job in #1092 is the only
thing that would notice a definition reading an unsupplied name.

**Be exact about how much that is worth.** It is a prerequisite for
configuring property-targeted flags, not remediation of a defect in shipping
access control. There is no access-widening hole to remediate: entitlement is
computed before the operator fold, and `reduceOnly` accepts a proposal only
when it names the same capability key, keeps the same grace class, and moves
that entry from available to unavailable. The failure this job detects also
needs a property-targeted flag to exist before anything can go wrong, and as
checked on the live project on 2026-08-20 there are no feature flags on it at
all. So the job is a gate on future configuration, and the correct time to
build it is before the first such flag is written.

**Recorded because the failure mode is worth keeping.** The disproved sentence
was written with no measurement behind it and read as settled fact for as long
as it stood. It was caught only because the claim was marked unverified and a
live test was scheduled against it. The lesson is the marking, not the vendor.

## Amendment, 2026-08-23: Tier policy moves capability; PostHog stages exposure

The commercial model now names the two Tiers **Free** and **Eido Plus**. Free
includes every Eido product capability through user-funded providers. Plus
adds Eido-managed OpenRouter and Linkup access; it is not a premium-feature
bundle.

The founder's direction to use PostHog when features move between Tiers does
not change this ADR's authority split. A feature moves between Free and Plus by
changing the versioned server Tier-to-capability policy. PostHog targets the
affected Tier to stage that policy rollout, temporarily withhold the capability,
or reveal its locked upgrade surface. It never performs the move itself and
never turns an unavailable capability into an available one.

This is the intended use of the mechanism already built. Tier is supplied
inline from Eido's account record on every flag evaluation; repo-declared flag
definitions may target the supported rollout percentage plus exact `eido_tier`
and `audience` person-property conditions. Cohort conditions are not supported.
The database and versioned policy remain reviewable entitlement
authority. PostHog remains a fast, reduce-only operator surface around that
authority.

For the current commercial policy, both Tiers receive all local product
capabilities. The meaningful Plus-only capability is Eido-managed provider
access. Future feature movement remains possible through a policy revision and
flagged rollout without weakening the rule: PostHog decides what is seen;
Eido's record and policy decide what can be done.

Unresolved, stale, or malformed Tier data keeps the Free local/BYOK baseline
and grants no managed authority. Managed OpenRouter and managed Linkup each
require the exact current Plus answer at the Account snapshot and every
server-side spend or funding gate; an over-generous Free row cannot grant them.

For a staged Plus rollout, Tier policy grants the managed capability first and
a reduce-only PostHog flag withholds it from accounts outside the rollout. The
founder progressively removes that withholding. PostHog never supplies the
positive grant.

Managed OpenRouter and managed Linkup Web Mode have separate reduce-only
operator controls. This lets the founder stage, withhold, or stop one managed
route without coupling its operational readiness to the other. Both controls
remain subordinate to Tier policy and neither touches personal BYOK.

The repository declares both managed-route controls separately and active for
evaluation. Their initial conditions are a 100-percent withholding rollout for
public or unknown audiences and the supported exact `eido_tier` values; a
server-only bounded Account allowlist supplies `audience: internal` for the
initial internal-first no-withhold audience. The operator can edit, stage,
remove, or fail one route without coupling it to the other; managed OpenRouter
may reach general availability without waiting for managed Linkup. Free and
ordinary BYOK capability are ungated immediately and never wait for either
rollout.

Withholding a managed route preserves personal BYOK and Usage Balance. A person
with a suitable key continues on that route. Without one, the interface says
**Unavailable** and may offer **Use Key**; it does not say Upgrade or Top Up,
because neither payment nor balance is the reason the route is unavailable.

The Free escape hatch is structural rather than a flag convention. Operator
controls cannot hide or disable **Add Key**, provider-key settings, or ordinary
BYOK execution. The declared/mutable PostHog capability namespace contains
exactly the managed OpenRouter and managed Linkup controls; it cannot declare a
Web, Research, Add Key, CLI, local-harness, or all-capability kill switch.

Signed-out, unavailable, and stale Account state therefore publish the five
Free local/BYOK capabilities as available while managed routes fail closed.
The headless Eido CLI follows the same rule: a legacy receipt or absent Account
subsystem cannot re-paywall local Profile access.
