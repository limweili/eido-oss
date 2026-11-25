# Decision-maker review content model

Use this as a set of lenses, not a mandatory table of contents.

## Executive summary

Answer, in this order:

1. What outcome did the epic reach?
2. Why does it matter?
3. What changed now?
4. What user or business effect remains future work?
5. What boundary is most likely to be misunderstood?
6. What does the founder, owner, or decision-maker need to approve, question, or decide?

Prefer three to five headline measures. Never use decorative metrics.

## Impact

Show the causal chain from evidence to value. Split impact into:

- **Delivered now:** shipped behavior, retired risk, resolved ambiguity, aligned authority, eliminated waste, operational readiness.
- **Enabled:** implementation or rollout that is now possible but not yet complete.
- **Expected later:** user, product, financial, reliability, or performance effects with explicit gates.
- **Not yet proven:** claims that available evidence cannot support.

Use quantitative evidence when representative: adoption, latency, memory, error rate, throughput, cost, coverage, closed decision space, delivery time, incident reduction, or removed complexity. Use qualitative impact when numbers would be false precision: clearer ownership, safer architecture, improved usability, reduced decision churn, better accessibility posture, or a simpler implementation path.

## Work delivered

Explain:

- the completion boundary: delivered versus intentionally excluded;
- the change set by coherent outcome, not only chronological PR order;
- the selected architecture or product decision and rejected alternatives;
- invariants preserved;
- rollout, rollback, dependency, and follow-up graph;
- exact source, tracker, review, CI, release, or artifact evidence where relevant.

Put exhaustive issue/PR/CI ledgers inside `<details>`.

## Technical teaching

Teach the minimum vocabulary needed to review the decision. Use analogies only when the mapping remains technically honest. For each complex idea, connect:

`mechanism → trade-off → product meaning → validation gate`

Good diagram candidates include architecture flows, state transitions, dependency graphs, timelines, cost stacks, and before/after comparisons. Add accessible titles and descriptions. Do not use diagrams as decoration.

## Retro and collaboration

Cover:

- strongest outcome and avoidable delay;
- actual bottleneck versus suspected bottleneck;
- quantitative evidence of friction where available;
- failed loops and the unblock;
- CI, testing, review, rebase, tooling, and coordination friction;
- owner interventions: effect, benefit, cost, and better future timing/framing;
- agent/orchestrator accountability;
- live-retro usefulness and final-retro usefulness;
- Keep / Stop / Start / Change;
- a compact future operating model and loose-end ownership.

Prefer a one-minute verdict before forensic detail.

## Decision-maker review prompts

End substantive sections with questions that expose real decisions, such as:

- Is the delivered-versus-enabled boundary acceptable?
- Is the selected trade-off aligned with product priorities?
- Which limitation must block rollout?
- Is the expected impact valuable enough to fund the next phase?
- Did any process correction arrive too late or create unnecessary churn?
- Which recurring friction should be removed before the next epic?

## Source register

List canonical sources by authority: executable specification, code/PRs, architecture, measurements, CI/release, and retro. State dates and exact heads where staleness matters. Do not include private data or credentials.
