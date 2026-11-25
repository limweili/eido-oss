# Execution and review — preserve intent at boundaries

## Give every lane a why-led contract

Start from [../assets/dispatch-contract-template.md](../assets/dispatch-contract-template.md)
when a written handoff helps. Include only information that changes how the
lane should be executed:

- why the lane matters to the epic;
- the observable outcome and definition of done;
- owned and protected surfaces;
- dependencies and current authoritative inputs;
- product and safety truths that apply;
- existing evidence to reuse and its invalidation boundary;
- active-writer and runtime-resource ownership where lanes share mutable state;
- required review or integration handoff.

Ask the executor to verify factual diagnoses against current source before
building. Do not copy every historical gotcha into every contract; include a
lesson only when the lane can encounter it.

## Verify confidence, not activity

Use the cheapest direct proof that addresses the lane's material risks:

1. Inspect the changed behavior and affected consumers.
2. Use static checks or focused tests at the public seam.
3. Add representative integration journeys when composition is the risk.
4. Reuse required exact-head proof rather than reproducing it in every role.
5. Add specialist or environmental evidence only when it is authoritative and
   decision-relevant.

Use the epic-level claim-to-proof map from
[testing.md](testing.md). A lane inherits valid proof for shared primitives;
it does not recreate that proof merely to appear independently complete.

A behavioral RED is valid only when the intended test executes against the
claimed seam and fails for the missing or broken behavior. Dependency,
tool-runner, fixture, or environment startup failures are setup or capability
failures; repair or classify them before interpreting product behavior.

A test is useful when restoring the plausible bug would make it fail. Replace
proxy assertions, exhaustive field matrices, and duplicated consumer tests
with shared-primitive reasoning or a broader behavioral journey.

When a broad test fails under resource contention, run the narrowest
discrimination needed to classify the failure. Do not rerun large suites until
one turns green, and do not lengthen timeouts to launder an environmental
problem.

## Review meaningful boundaries

For a material lane, obtain independent review along two axes:

- **Standards:** does the change honor repository architecture, conventions,
  safety, and maintainability?
- **Spec:** does it satisfy the lane's outcome without weakening the epic's
  product truths or adding undeclared behavior?

Give the reviewer the exact stable delta, contract, relevant context, and
named risks. Require a direct `PASS` or `BLOCK` with evidence. Closure review
covers the repair delta and its affected context; it does not restart a broad
audit unless the change invalidated the original reasoning.

If repeated execution or review loops hit the same boundary without new
information, change the approach, simplify the evidence, or reslice. More
instrumentation is not the default response.

## Hand off integration readiness

Use [../assets/handoff-template.md](../assets/handoff-template.md) to pass
pointers, dependencies, exact evidence boundaries, owned resources, and known
risks. Mutable readiness claims remain hints; the landing role re-derives them
from live state.
