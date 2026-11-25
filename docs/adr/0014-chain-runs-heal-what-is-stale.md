# ADR 0014: Chain Runs Heal What Is Stale

Status: accepted

## Context

Chain engine v1 (ADR 0013, issue #135) runs every upstream Ask AI whose result feeds the target, dependencies first. That answers *how* a chain runs but not *when steps should run at all*: re-running everything on every press burns tokens re-computing identical results, while running only the target quietly builds answers on stale upstream results. The product already detects staleness — every result version stores fingerprints of its sources, and the Source-changed badge compares them against the live board — but healing a stale pipeline is manual and order-dependent. Founder review (July 2026) confirmed the primary chain use case is exactly this: a line of Ask AI cards whose source notes changed, refreshed with one press.

## Decision

Running an Ask AI card always creates a new version for that pressed card. A planned upstream step executes only if it has never produced a result, its recorded sources changed (the existing fingerprint check), or any upstream step in the same chain ran (the cascade rule: a re-run parent makes every child stale by definition). Other upstream steps are reused, not re-run. An explicit "re-run everything" action runs the full plan unconditionally.

Guardrails, decided with the same review:

- **Confirm gate, no hard cap.** If a run would trigger more than N extra upstream steps (N is a user setting, default 2), a preview screen asks first; below that, healing is silent. There is no hard step limit.
- **Preview is minimal.** The preview lists the steps in run order, each with a short status tag as its reason ("Source changed", "Hasn't run", "Feeds from the step above"). No cost prediction until real per-run usage is recorded; predicted prices from heuristics would be wrong on a trust surface.
- **Failure halts loudly.** A failed step stops the chain, keeps completed fresh results, and marks where and why it stopped. Resume is not a feature: pressing Run again *is* resume, because the staleness rule skips what already succeeded.
- **Stop keeps what's done.** Cancel stops after the current step; the streaming step keeps its partial text as provisional (existing single-run behavior).

## Considered Options

- Chosen: stale-only execution by default, explicit full re-run, confirm gate above a user threshold, halt-loudly failure.
- Not chosen: always re-run the full chain — simplest to reason about, but pays full price for unchanged work and punishes the primary "heal my pipeline" use case.
- Not chosen: target-only runs (status quo) — silently answers from stale upstream results, the failure mode a thinking tool must not have.
- Not chosen: fail-forward past a failed step — completes the chain but builds later answers on a missing link.
- Not chosen: hard step caps — the confirm gate already puts a human in front of large spends; a cap would block the power users chains exist for.
- Later: auto-retry a failed step once inside the same halt-loudly shape; dollar figures on the preview once runs record actual usage ("last time this cost about X").

## Consequences

- Product: Run means "make me another answer" — one press always creates a new target version, heals a stale line of thought when needed, and asks permission before big upstream spends. Failure and cancel leave the board in an honest, resumable state.
- Engineering: execution is a filter over the existing plan (`planChainRun`) using the existing source-fingerprint check plus the cascade rule, with the pressed target included even when fresh; "re-run everything" is the unfiltered plan. The N threshold lives in the Settings page.
- Trade-off: staleness detection must be trusted — a false "fresh" skips a needed re-run. Acceptable because the same fingerprints already drive the user-facing Source-changed badge, so any such bug is already visible product-wide.
