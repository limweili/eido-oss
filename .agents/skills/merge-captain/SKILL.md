---
name: merge-captain
description: Land one change or a train of changes into shared state safely by re-deriving live readiness, ordering dependencies, reusing valid proof, serializing consequential mutations, verifying the landed result, and reconciling trackers and owned resources. Use when asked to merge, land, ship, triage pull requests, run a merge train, or close an epic.
---

# Merge Captain

Landing is a shared-state mutation, not another implementation phase. Preserve
work, use current evidence, make one consequential change at a time, and leave
the repository more truthful than you found it.

Merge Captain is a role. It may be held by a dedicated session or by an
authorized coordinator; the safety contract does not depend on that topology.

## Source precedence

Use this order:

1. Explicit owner authority and safety boundaries.
2. Live repository, review, delivery, and tracker state.
3. Current repository release and data-safety policy.
4. Evidence attached to the exact change being considered.
5. Handoffs, saved plans, and this skill's heuristics.

Treat mutable handoff claims as hints. Re-read the inputs to every
consequential action immediately before taking it.

## Readiness means enough current proof

Only evidence declared required by repository policy and change risk gates
landing. Classify each required signal as:

- **verified now** - observed on the current change after its last relevant
  mutation;
- **stale** - once valid, then invalidated by a new head, base, conflict
  resolution, policy change, or affected dependency;
- **absent** - not available or never produced.

Absent required proof is not green. Optional, canary, and experimental signals
do not silently become required gates; relevant red signals are still
investigated and reported according to repository policy.

Reuse valid exact-head proof. Do not repeat broad gates merely because another
role has taken ownership. A mechanical lineage update with an identical patch
does not require a fresh full review; a semantic conflict resolution or changed
behavior invalidates the affected review and evidence.

## Scale proof to landing risk

Use the repository profile to identify consequence, reversibility, shared
fan-out, data exposure, and deployment impact.

Test-driven development history and structured Standards/Spec review are
available evidence modes, not universal landing prerequisites. Require them
when repository policy or change risk needs their confidence; once selected,
use their specialist guidance rather than inventing a weaker substitute.

Accept review evidence only when its requested verdict is complete and bound to
the current change. A source-grounded counterexample outranks an approval until
the conflict is reconciled and the repaired identity is reviewed; where a cheap
executable probe can falsify a claim, prefer it to deeper review prose.

Expensive review runs under an explicit wall-clock and cost budget sized to the
change before dispatch. Overrun, transport failure, or a verdict-free exit
yields a formal INCOMPLETE - never a pass, never an unbounded retry. While a
paid review or landing is in flight, exactly one role may move that branch;
every other writer queues until the verdict is bound or declared INCOMPLETE.

- Low-risk, isolated changes normally rely on current required proof plus
  focused inspection of scope and affected behavior.
- Medium-risk changes add evidence at their affected public seams.
- High-risk shared, persistent, security, or difficult-to-reverse changes
  require independent review and the full repository-defined landing proof.

The landing role verifies evidence; it does not rebuild an exhaustive test
suite around every change. When a constrained host cannot produce
authoritative browser or performance evidence, use the repository's accepted
source instead of retrying local CPU-heavy gates.

## Landing loop

Use [references/landing-loop.md](references/landing-loop.md):

1. Inventory the requested changes and derive dependency order live.
2. Establish current readiness and classify every required signal.
3. Refresh the change against its current base without touching user-owned
   work.
4. Re-read the expected state, make one authorized mutation, and verify its
   immediate outcome.
5. Verify the shared target according to current repository policy before the
   next consequential mutation.
6. Reconcile the tracker, dependents, owned resources, and final report.

## Stacked changes

A stack is one dependency chain whose order is fixed by construction, so the
order is read rather than inferred. Four rules follow from the shape:

- Merging any layer lands every unmerged layer below it. The **merge set**, not
  the named pull request, is what must be ready.
- The merge set is all-or-nothing. One unready layer holds the whole set.
- A partial merge retargets and rebases every layer above the cut, so their
  exact-head proof becomes stale the moment it lands.
- One writer per stack. Any rebase rewrites every branch above it, which makes
  a stack a single serialized mutation.

Use [references/stacked-landing.md](references/stacked-landing.md) for the
mechanics, the review practices worth sending work back over, and the settings
that keep approvals alive across cascading rebases. The `gh-stack` skill owns
creating, splitting, and restructuring stacks; this skill owns landing them.

## Safety stances

Read [references/stances.md](references/stances.md) for live-state,
reversibility, preservation, surprise containment, and proportional evidence.
These principles generate the right response when a runbook cannot anticipate
the situation.

Bundled helpers are optional implementations of this contract. When the active
host cannot run one, do not rebuild the gate by hand lane after lane: fall back
once to the repository's declared authoritative source for that evidence class
(for gates, hosted exact-head CI) and record the host incapability. A helper
launch failure is absent capability, not a gate verdict.

## Coordination

When paired with ongoing implementation, use
[references/coordination.md](references/coordination.md). Exchange intent,
pointers, evidence boundaries, and ownership, not commands whose factual
premises will expire. Keep the owner out of the technical message path.

## Escalation boundary

Resolve ordinary freshness, ordering, conflicts with an already-authoritative
mechanical resolution, provider retries, and owned cleanup without asking.

Pause the affected action when an unresolved decision changes product or
architecture meaning, exposes real data or secrets, risks irreversible loss,
or exceeds current authority. An already-settled design or ordinary authorized
fix does not need another approval. Continue independent preparation and
present the observed blocker, options, and a recommendation.

## Learning without sediment

Apply a new lesson to the remainder of the train. Add it to this core skill
only if it generalizes beyond one repository or delivery system. Put stable
local policy in the repository profile, current state in the tracker, and
one-off incidents in the retro. Remove superseded rules instead of accumulating
another layer.

## Completion

Landing is complete when the intended changes are present in the shared target,
all repository-required post-landing proof is current, dependents and trackers
reflect reality, sensitive or user-owned work was preserved, owned resources
are reconciled, and residual risks are stated with evidence.

Load [references/triage.md](references/triage.md) only for backlog triage and
[references/failure-taxonomy.md](references/failure-taxonomy.md) when a signal
is red, missing, contradictory, or surprising. Templates in `assets/` are
optional reporting aids.
