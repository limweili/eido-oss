# Evidence baseline for epic #956

Pinned to `afa1c12f`, the commit this epic branched from. Measured 2026-08-18.

The point of this file is that no lane spends a session re-deriving debt it did
not create, and that no lane draws a conclusion from the wrong scope. Both
mistakes were made here before this file was right; the corrections are below
because they are the useful part.

## Run the canonical scope, and know what it excludes

```
npm test
```

That script is `vitest run` with four exclusions: `scripts/ci/*.test.mjs`,
`**/*.bench.test.ts`, `**/*.perf.test.ts`, and `**/*.browser.test.ts`. Each is
excluded for a reason and each has its own runner.

**A bare `npx vitest run src/` is the wrong scope and will lie to you.** It
sweeps in the browser suites, which need Playwright and fail to *load* rather
than fail a test, and the perf suites, which need a quiet host. The result reads
as "52 failed test files" against 3 actual failing tests, which invites exactly
the wrong conclusion about a diff that caused none of it.

| Suite class | Runner | When it is authoritative |
| --- | --- | --- |
| Unit and component | `npm test` | Always. Deterministic. |
| Browser | `npm run test:browser` (Playwright) | Always, under its own runner. |
| Performance | `npm run` the perf files directly | Only on a quiet host. |
| CI tools | `npm run test:ci-tools` (`node --test`) | Always. |
| Typecheck | `npx tsc --noEmit` | Always. Deterministic. |
| Bundle budget | `npm run build && node scripts/ci/bundle-budget.mjs` | Always. Byte counts, not timings. |
| Packaged app | a real packaged build | Nothing in any renderer suite exercises the CSP. |

## Known failing at `afa1c12f`, in the canonical scope

None on a quiet host. `npm test` is green at the base commit when nothing else
is running.

**One canonical-scope test is load-sensitive anyway**, which the perf exclusions
do not protect you from:
`scripts/electron/profile-mcp-sea-after-pack.test.mjs`, the macOS signing check,
shells out to `codesign` against a 5 second test timeout. On a machine running
two implementation lanes and a dev server it times out, and it times out
identically at `afa1c12f`, which discriminates it. Two separate reviews have now
seen Electron suites fail this way under load and correctly called it the host.

So the rule is not "any canonical failure is yours". It is: **a canonical
failure is yours unless it is a timeout, and a timeout is the host until you
have reproduced it at the base commit under the same load.** That check takes
one command and it is the whole difference between a real finding and an hour
lost.

## Known failing outside the canonical scope, and why it is not yours

**Performance budgets.** `src/performance/storeReport.perf.test.ts` misses a 3 ms
budget on `large-board setCardText`, measuring 14.77 ms at `afa1c12f` and
28.40 ms at the epic head on the same machine minutes apart.
`performanceReport.perf.test.ts` and `graphIndexReport.perf.test.ts` fail the
same way. The numbers track host load, not the code: this epic ran parallel
implementation lanes and a production build on the founder's laptop. ADR 0028 is
explicit that a failure explainable by a saturated host is a hypothesis about the
host until discriminated, and it is discriminated here, because the base commit
fails too. These files are excluded from `npm test` precisely so this cannot
block a lane.

**Browser suites under the wrong runner.** They fail to load under plain vitest
and pass under Playwright. Not a finding, a scope error.

## A trap that cost one lane a wrong conclusion

A lane reported `electron/productAnalyticsService.test.ts` failing on a missing
`posthog-node` and called it pre-existing repo debt. It is not.
`posthog-node` is a declared dependency, it is installed in the founder's
checkout, and the test passes at `afa1c12f`. What was missing was that module in
*that lane's isolated worktree*.

The lesson generalises past this package: **an isolated worktree is not the
repository.** Before calling a failure pre-existing, reproduce it in a checkout
that is not yours, or check the base commit. "It fails here too" is the claim
that matters, and "here" has to be somewhere else.

## Budgets in force mid-epic (after #961; the close-out numbers are below)

* Total JavaScript: 497 KiB gzip. Head measured 494.9 on 2026-08-18 after #961.
* Single chunk: 770 KiB raw. Head measured 760.9 on 2026-08-18 after #961.

Both were moved for this epic and both carry their reasoning in
`scripts/ci/bundle-budget.mjs`. Roughly 2 KiB of gzip remains.

#957 allowed 6 KiB for four lanes and #961 alone spent 3.4, because it was by
far the largest slice. That is a wrong estimate, not a wrong principle, and it
does not by itself buy a third ceiling move. A lane that would blow the budget
reports its number and stops. One measured decision is made at epic close,
against the finished total, with the vendor SDK still refused in favour of plain
fetch and no main-process dependency admitted to the renderer.

## Where the budgets finished (epic close, 2026-08-18)

The measured decision above was made twice, and both moves carry their full
reasoning in `scripts/ci/bundle-budget.mjs`:

* Total JavaScript: **503 KiB gzip**. The integrated branch measures 499.6.
  The 497 allowance was spent to the byte (497.0 measured) by the pivot to
  dynamic tools: the model now chooses depth and parameters per call, so the
  tool declarations carry their own selection rules and the travelling brief
  rides in the prompt, and both are strings, which are most of what a renderer
  bundle weighs. 503 is a further 6 KiB sized for the three lanes then still
  to land (the research executor and polling, the thinking rows and the
  expandable trail, the reach words) plus Board Info's wire record, all of
  which have landed.
* Single chunk: **784 KiB raw**. The big chunk measures 772.6. The old 770 was
  set on a roughly 3:1 raw-to-gzip assumption; the prose-heavy additions gzip
  better (3.29:1), so 784 re-aligns the chunk guard to expire together with
  the total instead of ahead of it.

The refusals are unchanged at close: the vendor SDK is still declined in
favour of plain fetch, and no main-process dependency is admitted to the
renderer bundle.
