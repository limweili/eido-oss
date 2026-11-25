# Stances — how to reason about shared-state mutation

## Trust live state, not reports

Every handoff and status statement has a timestamp. Re-derive the facts needed
for the next mutation from their current authoritative sources.

Treat procedural instructions as intent plus hints. Rechoose mechanics when
their premises no longer hold.

## Required signals have three states

A required signal is verified now, stale, or absent. Only verified-now proof
can authorize the action it guards. Optional signals remain separate; their
absence does not block, while relevant reds still receive investigation and an
honest disposition.

## Gate by consequence and reversibility

Read freely. For reversible actions, verify inputs and outcome. Before an
irreversible or expensive action, re-read live state, state the expected
result, and preserve recovery options.

Preserve before destroying. Uncertainty about ownership or dependency means
keep the resource until it can be resolved safely.

## Serialize shared mutation

Parallelize observation and preparation. Serialize mutations whose effects or
proof can invalidate one another, and verify the shared target between them.

## Stop on surprise

When actual state differs from the expected predicate:

1. Freeze the dependent mutation sequence.
2. Record expected and observed facts.
3. Bound what changed and what did not.
4. Diagnose before recovery.
5. Escalate only when recovery crosses the owner boundary.

## Reuse proof proportionally

Verification should answer whether the current change is safe to land, not
reproduce every earlier role's work. Reuse exact, unexpired evidence; rerun only
what a relevant mutation invalidated. Prefer targeted discrimination over
repeated broad gates when environment contention is the likely cause.

## Keep the owner out of mechanics

Ask for product, safety, cost, or irreversible-risk decisions. Do not ask the
owner to route messages, inspect implementation details, or approve ordinary
technical recovery.
