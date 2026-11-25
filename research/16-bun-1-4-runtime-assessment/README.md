# Bun 1.4 for Eido

Status: complete

Point-in-time research as of 2026-08-23 on whether Bun 1.4 is worth adopting in Eido, what it could replace, what should stay, expected performance effects, and lifetime maintenance trade-offs.

Decision: do not migrate Eido's shipped runtime, product stack, Profile authority, or release path to Bun 1.4. Consider a reproducible, non-authoritative package-installer canary only if Eido's measured annual install, onboarding, and CI waiting cost can repay a 3–7 day experiment plus continuing dual-toolchain maintenance. A standalone CLI or harness benchmark is a separate optional track and must not own Profile data.

Founder decision, 2026-08-24: Eido will not move to Bun. The conditional canary remains research context rather than planned work.

## Documents

- `00-goal-and-lanes.md` — decision boundary, evidence standard, and lane ownership.
- `01-eido-current-stack.md` — Eido's current technology and workload map.
- `02-bun-1-4-capabilities.md` — Bun 1.4 capabilities and compatibility from first-party sources.
- `03-performance-evidence.md` — benchmark evidence and estimated effects by workload.
- `04-runtime-fit.md` — fit for Eido's canvas, cards, AI, database, and desktop runtime paths.
- `05-lifecycle-tradeoffs.md` — migration, release, ecosystem, and long-term maintenance risks.
- `06-synthesis.md` — integrated recommendation and staged adoption boundary.
- `07-adversarial-review.md` — independent challenge of the synthesis.
- `bun-1-4-for-eido.html` — self-contained visual decision brief.
