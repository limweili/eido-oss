# ADR 0028: Risk-Proportional Evidence Over Fixed Ceremony

Status: accepted

## Context

Two consecutive epics documented the same failure mode from opposite sides.
Epic #410's retro concludes that "validation had become a parallel product":
roughly 14,000 lines of benchmark, guard, and evidence machinery accumulated
around one architecture decision, ~82–85% of its friction entries were the
apparatus breaking or proof being rebuilt rather than product defects, and the
decision itself landed within hours once the suite was trimmed from 205 cases
to 23 representative tests. Epic #520 paid the same tax through review and
gate ceremony: $3–6 and 17–48 minutes per review verdict, repeatedly
invalidated by branch movement; per-lane re-proof of known baseline debt; and
local gate runs on a host that could not execute them.

The countervailing evidence is equally clear: roughly one in six friction
entries was a genuine catch, and those catches cluster at security and
external-mutation boundaries, adversarial review of real product behavior, and
cheap executable counterexamples — not in broad per-slice re-proving.

Until now the testing philosophy lived only in skill files that load when a
skill is invoked. No ADR covered evidence policy, so an agent told to
"re-derive from first principles" found nothing to derive from. This ADR is
that source. The full diagnosis is in
`docs/retros/reports/2026-07-19-testing-bottleneck-diagnosis.html`.

## Decision

Evidence — tests, gates, benchmarks, reviews, instrumentation — is an
instrument for exactly one question: **would more proof change what we do
next?** When the answer is no, the work lands.

The binding principles:

1. **Proof scales with risk.** Irreversible actions, shared-state mutations,
   security boundaries, and external-provider contracts earn deep adversarial
   evidence. Routine reversible work earns the cheapest authoritative check.
   Nothing earns proof repeated for ceremony.
2. **Prove once, reuse everywhere.** A shared behavior is proven once at its
   authoritative seam; that proof is reused across consumers and slices until
   a relevant change invalidates it. A mechanically identical lineage change
   invalidates only the affected gate, never the full review stack.
3. **Broad seams over narrow pins.** Prefer a few representative tests at real
   product seams over many tests pinned to internals. Narrow tests fossilize
   today's implementation and tax tomorrow's change; a lexical or
   source-location pin is not an authoritative behavior classifier.
4. **Tests follow the product, never the reverse.** When architecture moves,
   tests and spec text move with it. A test failing because its behavior was
   intentionally retired is a deletion, not a blocker. Implementation evidence
   may amend a stale spec; the agent owns the amendment and escalates only
   consequential product choices. An epic that deliberately changes
   architecture names the tests and SOP sections it retires as one visible
   decision at kickoff.
5. **Validation must never become a second product.** Tripwires, any of which
   forces a stop-and-reslice rather than more machinery: evidence machinery
   rivals the size or complexity of the change it validates; any validator,
   guard, or harness reaches a second version; a failing check is explainable
   by the host or environment rather than the code; proof is being rebuilt for
   a head that has not semantically changed.
6. **Environment is declared, not fought.** Each epic declares once which host
   is authoritative for which evidence class and publishes a SHA-pinned
   inventory of known pre-existing failures. A host that cannot run a gate
   contributes no gate evidence; lanes do not re-derive or re-explain known
   baseline debt.
7. **Falsifiable beats prestigious.** A cheap executable counterexample
   outranks a reviewer verdict when they conflict. Expensive review runs under
   an explicit time and cost budget; overrun or transport failure yields a
   formal INCOMPLETE, never a pass and never an unbounded retry.

## Considered Options

- Chosen: one principle-level ADR that skills, AGENTS.md, and agents cite,
  with mechanics left to the delivery skills.
- Not chosen: encoding thresholds (case counts, dollar caps, coverage bars)
  in this ADR, because fixed numbers are the ceremony this decision removes;
  budgets are set per dispatch by the orchestrating role.
- Not chosen: reducing total test coverage as a goal in itself, because the
  genuine catches (provider mock shapes, credential binding, prototype
  pollution, symlink escape, stale-raster invalidation) justify deep evidence
  exactly where risk concentrates.
- Not chosen: leaving the philosophy distributed across skill references,
  because duplicated restatements drift and unloaded skills leave agents
  without any first principles to re-derive from.

## Consequences

- `AGENTS.md` carries a compact statement of these principles so every agent
  session sees them; skills and references point here instead of restating
  the risk ladder.
- Epic Orchestration enforces the tripwires and the per-epic environment
  verdict, known-debt inventory, and architecture retire-list. Merge Captain
  enforces review budgets, the INCOMPLETE outcome, and single-writer branches
  under paid review. DevOps Coach checks harness-share of effort and evidence
  yield as standing health metrics.
- Honest absence remains honest: missing instrumentation is reported as
  not-measured and may block a decision that truly depends on it. This ADR
  removes ceremony, not truthfulness.
- Evidence labels stop at observable causal barriers. In #527, closing the
  parent's MCP read end before the mutation response is observed, followed by a
  fresh-process exact replay at one revision, proves an ambiguous exactly-once
  outcome. It does not prove that the close occurred after an internally
  observable Gateway admission point or interrupted an in-flight mutation. No
  proof-only timing hook is added because that stronger claim does not change
  the shipping decision.
