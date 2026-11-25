---
name: epic-orchestration
description: Coordinate a large goal that exceeds one execution context by preserving its why, mapping dependencies, forming coherent lanes, delegating work, integrating evidence, and converging on a verified outcome. Use for epics, PRDs, programs of related issues, or parallel workstreams that need system-level coordination.
---

# Epic Orchestration

An epic is a convergence problem. Preserve the destination and whole-system
coherence while independent work advances. Coordinate from first principles;
do not turn one successful execution method into a universal workflow.

## Source precedence

Use this order whenever guidance conflicts:

1. The explicit goal, product truths, and safety boundaries.
2. Live product, repository, tracker, and delivery state.
3. Evidence and learning from the current run.
4. Current repository policy.
5. This skill's reusable heuristics.

Cached progress, old plans, and handoffs are hypotheses with timestamps.
Re-derive mutable facts before relying on them.

When direct implementation evidence disproves an operational assumption without
changing the goal's product or safety truths, amend the governing specification
and any affected decision or tracker record, then continue. Escalate only the
consequential choice that remains unresolved.

## Own the system-level decisions

Keep the orchestration context focused on decisions that require the whole
map: destination, dependencies, ownership, integration order, evidence,
review boundaries, and unresolved risk. Delegate bounded execution when it
improves throughput or context isolation. Take direct action only when it is
the smallest safe way to remove coordination overhead.

## Convergence loop

1. **Orient.** Restate why the outcome matters, what must remain true, what
   done means, and what live state changes the plan. Read
   [references/preflight.md](references/preflight.md).
2. **Map.** Identify dependencies, shared ownership, risky seams, decision
   gates, and the serial spine. Every blocking edge must name the direct
   technical mechanism by which one item blocks another, verified against the
   code; tracker links and inherited plans are hypotheses, not edges. When the
   epic deliberately changes architecture, the map also names the tests, spec
   text, and SOP sections the new architecture retires — retired in one
   visible decision at kickoff, not fought lane by lane.
3. **Slice.** Form the smallest coherent lanes that produce product or
   decision value. Choose isolation and parallelism from collision risk, not
   from a fixed topology. Read [references/slicing.md](references/slicing.md).
4. **Execute the frontier.** Give each active lane a why-led contract and
   enough independence to finish. Keep shared decisions in one authoritative
   place. Read
   [references/dispatch-and-review.md](references/dispatch-and-review.md).
5. **Integrate continuously.** Recompute dependencies as work lands. Build
   later work on current reality instead of maintaining a large speculative
   stack.
6. **Close the loop.** Reconcile the tracker, owned resources, evidence,
   deferred findings, and definition of done. Report outcome and residual
   risk, not activity volume.

## Evidence discipline

Evidence exists to reduce uncertainty about the goal. Tests, benchmarks,
review, and instrumentation are confidence tools, not deliverables. First
principles live in ADR 0028 (risk-proportional evidence); when any rule below
conflicts with observed reality, re-derive from there.

At kickoff, declare once which host is authoritative for each evidence class
and publish a SHA-pinned inventory of known pre-existing failures. A host that
cannot run a gate contributes no gate evidence; no lane re-derives or
re-explains inventoried baseline debt.

Choose testing depth from consequence, novelty, shared fan-out,
reversibility, and observability. Read
[references/testing.md](references/testing.md) before defining lane-level
validation.

- Start with code review, static reasoning, and existing proof.
- Add targeted tests at the public seam where a plausible regression would
  be observed.
- Prove a shared primitive once at its authoritative seam and reuse that
  evidence across slices; add consumer tests only for distinct integration
  behavior.
- Prefer a few representative end-to-end journeys over field-by-field or
  consumer-by-consumer duplication.
- Run broad required proof once a meaningful head is stable. Reuse it until
  a relevant change invalidates it.
- Use browser, performance, or machine-sensitive evidence only when it can
  answer a material product question under authoritative conditions.
- Treat a failure from a saturated or incapable environment as a hypothesis
  about the environment until discriminated.

Use a test-first tracer bullet for high-risk behavior when a direct red seam
exists. Medium-risk work normally needs representative seam coverage. Low-risk
mechanical work may need no new test when static review and existing required
proof already discriminate it.

Stop and reslice when evidence machinery approaches the complexity of the
change, repeats proof already established elsewhere, or no longer affects a
decision. A resolved architectural question does not need a second product
built around its evidence.

These tripwires force that stop; they are acted on by the orchestrator, not
escalated:

- a lane's evidence diff outweighs its product diff;
- any validator, guard, or harness reaches a second version;
- a failing check is explainable by the host or environment rather than the
  code;
- proof is being rebuilt for a head that has not semantically changed.

On a trip, pause the lane, answer "would more proof change the decision?" in
one written paragraph, then reslice or delete the machinery. More apparatus is
never the response to a tripped wire.

## Review discipline

Select test-driven development and structured review by risk and decision
value. Their specialist engineering guidance governs technique after selection;
it is not universal orchestration ceremony.

Use independent Standards and Spec review for meaningful, stable lane
boundaries. Review the exact delta and its affected context, name the risks,
and require a direct pass or blocking finding. Do not recursively orchestrate
review or repeat a full review after a mechanically identical lineage change.
Give expensive review an explicit time and compute budget. A timeout, partial
result, transport success, or process exit without the requested verdict is
incomplete evidence, never a pass.

## Coordination memory

Keep the smallest durable record that makes recovery possible: decisions,
current ownership, blocking edges, owned resources, evidence locations, and
unresolved risks. Treat it as a cache over live sources, not a competing
source of truth. Archive completed ownership instead of allowing active state
to grow indefinitely.

## Human boundary

Resolve mechanics without using the owner as a router. Escalate when the
destination or safety boundary genuinely needs an owner decision: product
behavior, architecture meaning, real-data exposure, security posture,
irreversible loss, or a review disagreement that survives evidence.

Give concise scoreboard updates using
[references/human-interface.md](references/human-interface.md).

### Blocker logging

When a blocker requires the owner's manual intervention, credentials, external
setup, or a decision only the owner can make:

1. **Log it immediately** in the current work record. When issue posting is
   authorized, also comment on the relevant GitHub issue. Include context, what
   is blocked, why it needs the owner, and the recommended action.
2. **Do not stop work.** Continue with the rest of the implementation,
   skipping or stubbing the blocked area.
3. **Report at completion.** When the run finishes, collect every
   owner-dependent blocker from the work record and authorized issue comments and present them as a
   consolidated checklist so the owner can resolve them in one batch when they
   have time. Nothing gets lost between logging and reporting.

## Learning without sediment

Apply a useful lesson to the remaining run immediately, then place it at the
smallest durable scope:

- goal/specification — product intent or safety;
- core skill — cross-context responsibility or decision principle;
- repository policy — stable local requirement;
- current run record — ownership or mutable state;
- retro — one-off incident or unproven pattern.

Promote a lesson into this skill only when it recurs across contexts,
prevents meaningful harm, survives a change of tools, and can be stated as a
positive principle. Prune or replace superseded guidance whenever adding a
rule.

## Completion

The epic is complete when the goal's observable outcome is integrated, its
product and safety truths still hold, required evidence is traceable, the
tracker and delivery state agree, owned resources are reconciled, and every
remaining loose end has an explicit owner or deliberate disposition.

Use the templates in `assets/` as optional compression aids, adapting their
shape to the work rather than treating them as mandatory forms.
