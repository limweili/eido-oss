# Goal and research lanes

## Decision outcome

Decide whether Eido should adopt Bun 1.4, and at which seams. The answer must distinguish toolchain adoption from replacing Node.js or Electron in the shipped product. It must name every material current technology affected, quantify likely improvements or regressions by user and developer workload, identify technologies that should remain, and explain lifetime maintenance trade-offs.

## Scope

- Current Eido repository architecture, package graph, scripts, build, tests, packaging, persistence, AI execution, and performance-sensitive canvas paths.
- Bun 1.4 and current first-party Bun documentation available on 2026-08-22.
- Node.js, npm, Vite, Vitest, Playwright, Electron, React, TypeScript, SQLite/native bindings, packaging/signing, CI, and any other technology actually present in Eido that Bun could plausibly touch.
- Percentage estimates must state the measured baseline or mechanism, give ranges rather than false precision, and distinguish wall-clock wins from product latency that Bun cannot affect.

## Exclusions

- No production code, lockfile, build, or CI migration.
- No claims based only on vendor headline benchmarks.
- No paid API or external AI calls.
- No proof against a real Eido Profile. Any local experiment must use source/config inspection or disposable data.

## Freshness and evidence standard

- External claims use first-party documentation, release notes, repositories, issue trackers, or reproducible local measurements, with dates and URLs.
- Eido claims use exact repository paths and line or symbol evidence. The codebase knowledge graph is preferred for code discovery.
- Facts, measurements, inferences, estimates, and recommendations remain visibly distinct.
- Unsupported percentage estimates are prohibited. If direct Eido-on-Bun measurements are unavailable, use a mechanism-based range and explain what benchmark would narrow it.

## Lane map and ownership

| Lane | Owner file | Independent question |
| --- | --- | --- |
| Current Eido stack | `01-eido-current-stack.md` | Which technologies and execution paths exist today, and which Bun adoption seams are real? |
| Bun 1.4 capability surface | `02-bun-1-4-capabilities.md` | What does Bun 1.4 officially implement, improve, replace, or still qualify? |
| Performance evidence | `03-performance-evidence.md` | What trustworthy measurements support speed or slowdown estimates for installs, scripts, tests, builds, runtime, I/O, and native integration? |
| Eido runtime fit | `04-runtime-fit.md` | Which Eido user workloads can Bun affect, which are dominated by Electron/Chromium/React/canvas/network/model latency, and where can it regress? |
| Lifetime trade-offs | `05-lifecycle-tradeoffs.md` | What migration, compatibility, release, security, ecosystem, staffing, and maintenance costs compound over Eido's lifetime? |
| Coordinator synthesis | `06-synthesis.md` and HTML | What staged recommendation best fits Eido, with explicit replace/retain boundaries and reversal conditions? |
| Adversarial review | `07-adversarial-review.md` | Which synthesis claims lack evidence, confuse correlation with causation, or underestimate downside? |

The five research lanes are disjoint by evidence type and artifact. The coordinator owns shared indexes, estimates reconciliation, synthesis, and the final visual report.

## Token constraint and stopping rule

Each lane should produce 800 to 1,500 dense words plus citations. Stop when every material user category has a supported or visibly qualified estimate, the replacement matrix is complete, and further evidence would not change the staged recommendation. One targeted follow-up per lane is the default maximum.
