# Performance Foundation Workflow Retro

> Date: 2026-06-22
> Scope: PRD, issue planning, implementation, PR, merge, and issue closeout for Performance Foundation v1.

## Bottom Line

The workflow achieved the right outcome: a merged performance foundation with real measurements, a PRD, issue structure, future-feature gate, and local/GitHub verification. The app moved forward without a wholesale rebuild, and the open issues now represent the next true architecture slices rather than vague performance anxiety.

The process was effective, but not as efficient as it should be. I created a lot of value by staying evidence-led, yet I spent extra time because I did not mirror CI and current `main` early enough, and I treated "goal complete" as implementation-complete before the merge/closeout lifecycle was fully finished.

## What Went Well

- I converted a broad concern into a testable goal before implementing: Performance Foundation v1.
- I separated prototype foundation work from future architecture work instead of forcing a full rebuild.
- I used measurement to make decisions: Timeline Projector, store operation baseline, browser harness, and before/after bottleneck evidence.
- I kept the tldraw boundary clear: reference only, no SDK migration.
- I avoided closing issues that were not actually completed. Graph Index, deeper render lookup migration, text/stream batching, and persistence retention stayed open.
- I caught a rebased performance interaction with visual decay before merge and scoped decay computation to visible Cards.
- I completed the GitHub lifecycle: PR, CI fix, merge, local main sync, issue closeout, and worktree cleanup.

## Where I Was Inefficient

- I should have created the feature branch from latest `origin/main` before heavy implementation. Rebasing late forced avoidable conflicts with the agent docs and `Board.tsx`.
- I should have mirrored CI immediately after reading the workflow: Node 20 plus npm 10 and `npm ci`. Local npm accepted a lockfile shape that GitHub rejected.
- I should have made "merged and issues closed" part of the explicit definition of done from the start, not a follow-up after marking the implementation goal complete.
- I updated benchmark docs multiple times because local timing changed between runs. I should distinguish "representative baseline" from "exact latest run" and record the command/date/environment instead of chasing every small timing fluctuation.
- I let the first performance-foundation slice get fairly large. The scope was coherent, but a thinner first PR could have landed the PRD, fixtures, and report command before source optimizations.
- I did not hard-budget the browser harness yet. It measures and exposes regressions, but only Timeline Projector budgets currently fail the command.

## Strategic Lessons

Future performance goals should have three layers:

1. Product outcome: the user-facing capability or feeling we are protecting.
2. Engineering proof: the command, browser harness, or trace that proves it.
3. Lifecycle completion: merged PR, synced local main, closed issues, and remaining work explicitly tracked.

Architecture planning should separate four classes of issue:

- Foundation issues that must ship now.
- Measurement issues that make future decisions possible.
- Optimization issues that improve a measured bottleneck.
- Architecture migration issues that are intentionally deferred until evidence demands them.

This keeps the team from confusing "we know this will matter someday" with "we should rebuild it now."

## Tactical Changes For Next Time

- Start by fetching and branching from latest `origin/main`.
- Read CI before local verification and run the exact install path early, including npm major version.
- Define the done criteria as: docs written, issues published, implementation verified, PR merged, issues closed, primary checkout synced.
- Put PR close keywords only on issues actually completed by the PR; use `Refs` for the rest.
- Run browser performance after rebasing, not only before. Main-branch features can interact with performance-sensitive paths.
- Record benchmark numbers once per final rebased verification run, then stop unless code changes.
- Keep generated files out of the diff by checking status after every build and browser run.
- When a performance doc becomes the source of truth, update the index in the same patch.

## Goal-Setting Improvements

For future goals, I should write the goal in this shape before starting:

```text
We are done when [user/product outcome] is supported by [specific local/GitHub evidence],
merged through [PR/issue lifecycle], while [explicitly deferred work] remains tracked in [issues].
```

For example:

```text
We are done when large-board browser pan/zoom has a repeatable budget and the worst measured render lookup path
uses the Graph Index, verified by npm run perf:browser and npm run perf:report, merged through a PR that closes
the render migration issue while leaving unrelated persistence work open.
```

This forces me to name the success proof, the merge/issue lifecycle, and the non-goals up front.

## Next Best Performance Program Move

The next slice should not be another broad "make it faster" task. It should be one of these:

1. Graph Index v1: create the shared lookup module and migrate one measured lookup path.
2. Browser pan/zoom budget: turn the browser harness into a budgeted regression test and attack the highest pan/zoom cost.
3. Text/stream batching: reduce high-frequency update pressure for typing and AI output streaming.
4. Persistence payload baseline: measure save size and serialization cost before designing durable retention.

My recommendation is Graph Index v1 first, because it creates the reusable infrastructure needed by render migration, batching decisions, and future feature work.

## Personal Operating Rule

When the user asks me to own a long technical goal, I should treat "implementation complete" as an internal milestone, not the finish line. The finish line is shipped, verified, locally synced, tracker-clean, and with the next open questions deliberately named.
