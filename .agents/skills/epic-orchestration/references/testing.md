# Risk-led testing — confidence across slices

Testing should maximize confidence gained per unit of time, compute, and
maintenance. The epic owns one validation strategy across lanes so each lane
does not rebuild proof for the same behavior. In this repository the first
principles behind this reference are recorded as ADR 0028; when this document
and observed reality disagree, re-derive from the ADR.

## Start with the claim and seam

For every material behavior, name:

- the user or caller outcome;
- the public seam where that outcome is observable;
- the plausible regression the proof must catch;
- which lanes and consumers share the same primitive;
- the cheapest evidence that would discriminate success from failure.

Prefer a red-capable test through the public interface. Avoid assertions on
internal calls, duplicated implementation logic, configuration flags, or
upstream proxies that can remain green while the user outcome is broken.

## Assign depth by risk

Risk rises with irreversible harm, user or data impact, architectural fan-out,
novel behavior, weak observability, and difficult rollback.

### High risk

Use a focused red → green tracer bullet at the authoritative seam when
feasible. Add the smallest component or integration journey needed to prove
composition, safety, or compatibility. Examples include persistence semantics,
security boundaries, first-intent interaction, shared state machinery, and
high-fan-out public contracts.

### Medium risk

Use a representative public-seam test or extend an existing behavioral
journey. Reuse shared-primitive proof and add a consumer case only when that
consumer introduces a distinct integration boundary.

### Low risk

Prefer static review, type or schema checks, focused existing tests, and the
repository's required exact-head proof. Do not create a new test merely
because a file changed.

Reassess risk when implementation reveals a wider blast radius or a simpler
seam. The labels guide judgment; they are not quotas.

## Test across slices

- Maintain one epic-level map from material claims to authoritative proof.
- Let a shared module's seam tests cover all lanes that consume its unchanged
  contract.
- Use a small number of composed behavioral journeys to validate several
  landed slices together.
- Run consumer-specific tests only for behavior introduced at that consumer's
  boundary.
- Remove superseded or duplicate cases before committing when one stronger
  test covers the same regression.

Do not horizontally specify an entire epic with hundreds of tests before
learning from implementation. Advance vertically: one high-value seam, one
red-capable tracer bullet, the minimum implementation, then the next material
risk.

## Budget shared compute

Parallel execution does not imply parallel heavy validation. On a shared or
resource-constrained host:

- serialize CPU-, browser-, build-, and performance-heavy gates;
- continue code review, static analysis, documentation, and other light work
  while a heavy gate owns the machine;
- run targeted tests during iteration and the broad required gate once a
  meaningful combined head is stable;
- avoid repeating the same broad proof in execution, orchestration, review,
  landing, and CI roles;
- do not treat local performance or timing as authoritative when ambient load
  cannot be controlled.

When unrelated tests rotate under load, run the narrowest discriminator and
reduce concurrency. Do not expand timeouts, rerun the full suite repeatedly,
or build machine-cleanliness infrastructure unless the product decision truly
depends on that measurement.

## Stop condition

Testing is sufficient when every highest-risk material claim has direct,
discriminating proof; representative composed behavior is covered; lower-risk
changes are covered by static reasoning or existing required proof; and no
remaining test would materially change the decision to integrate.

Tests are over-engineered when they duplicate a proven primitive, validate
the evidence system rather than the product, enumerate fields without a
plausible regression, or consume more delivery capacity than the uncertainty
they remove.
