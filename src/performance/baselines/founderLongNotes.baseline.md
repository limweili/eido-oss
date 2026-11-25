# Founder long-Note scenario diagnostic baseline (#751)

Status: **diagnostic only; timing and feel not measured**.

This record follows ADR 0028 and the founder's 2026-07-23 evidence amendment on issue #751. The orchestration host is not a controlled performance host, so local timing was not captured or promoted into a release verdict. Manual feel and performance acceptance remains at F7.

## Provenance

- Source commit: `7c1375c8719b10c72aeabdf823faa5b26523fe69`
- Recorded at: `2026-07-22T15:41:58Z`
- Provider: local unmanaged orchestration host (uncontrolled)
- Host class: Darwin 26.5, arm64
- Toolchain used for structural proof: Node v24.12.0, npm 11.6.2
- Browser: not measured
- Fixture: `founder-long-notes-v1`
- Scenario: `many-long-notes-reading`

No hostname, local path, real Profile, legacy browser save, or user content is retained here.

## Source and unit-derived fixture facts

- 30 deterministic, synthetic Note Cards.
- Every Card is auto-sized: no Card has a stored `size`.
- Body lengths span 1,201–24,000 characters; every body exceeds the retired 1,200-character preview-cap scale.
- Aggregate body text is 374,005 characters, above the retired 300,000-unit Board-wide weight-cap scale.
- The fallback Card geometry occupies board bounds `(0, 0) → (1760, 1500)`, wholly inside the declared 1440×1000 Reading viewport at zoom 0.5 centred on `(750, 750)`.
- The fixture has no Connections, Outputs, Runs, or Intent events and passes the existing privacy scan.
- Structural proof: `npx vitest run src/graph/perfFixtures.test.ts --reporter=verbose` — 8/8 tests passed.
- Compile proof: `npm run typecheck` — passed on the source commit above.
- Earlier implementation build proof: `npm run build` — passed at `0e70bc603538cb2721aaefe489ff4c100a771f6d`; it was not repeated for the probe-only repair.

## Standing structural assertions

When the opt-in scenario is invoked, it reuses the existing probe, scene-counter, and owner-snapshot seams to assert:

- The static Overview-to-Reading transition sample has zero blank-board frames, zero missing-representation frames, and no more than 30 resident Card DOM nodes.
- Counters reset immediately before that transition report at least one scene derivation and zero Card-metric visits, so the viewport-only transition must exercise the scene without re-inspecting Card metrics.
- A separate settled four-frame sample has a non-zero resident set, no min/max variation, and no more than 30 resident Card DOM nodes. This is a bounded sample, not a full plateau trajectory.
- One at-rest snapshot across all 30 fixture Cards has zero activation-owner tokens. This does not prove every future owner lifecycle.

These are executable standing assertions, not observations captured for this baseline. The browser command was not run for #751.

## Diagnostic ledger

| Signal | Baseline | Boundary |
| --- | --- | --- |
| Style/layout time | `not-measured` | No controlled timing host; local timing is not a release verdict. |
| Long tasks | `not-measured` | No browser performance run by founder instruction. |
| Detailed-ready time | `not-measured` | No browser performance run by founder instruction. |
| Resident-DOM plateau | `not-measured` | The standing scenario checks min/max equality only over a separate settled four-frame sample; no full trajectory was captured here. |
| Blank frames | `not-measured` | The standing scenario checks the static transition when invoked; it was not run here, and fast pan/zoom evidence remains manual. |
| Scene derivations | `not-measured` | The standing scenario asserts at least one during the static transition when invoked; it was not run here. |
| Card-metric visits | `not-measured` | The standing scenario asserts zero during the same viewport-only transition when invoked; it was not run here. |
| Live-owner bound | `not-measured` | The standing scenario checks one empty at-rest snapshot; no lifecycle-wide bound was captured here. |
| Perceived fluidity | `not-measured` | Founder manual verdict at F7. |

## F7 closeout preparation

Status: **composed broad compatibility green; hosted Required and founder's packaged verdict pending**.

The founder's evidence direction for #749 leaves the Playwright standing route below unrun; F7 will not treat it as automated closeout proof. Every signal in the diagnostic ledger therefore remains `not-measured`. On the source composition at main `7ba60f6`, the following non-browser compatibility selection passed 8 files / 49 tests under Node v24.12.0 and npm 11.6.2:

```sh
npm test -- src/graph/perfFixtures.test.ts src/graph/boardSemantics.test.ts src/canvas/BoardSearchPanel.test.tsx src/canvas/keyboard.test.ts src/canvas/Board.controlledNodes.test.ts src/canvas/cardFocusOwnership.test.tsx src/graph/saveLoadCompat.test.ts src/graph/cardAssetCompat.test.ts
```

That result covers fixture integrity, saved-graph search/copy, keyboard/focus continuity, and load/save/reload/export authority; it is not a performance or feel verdict. The hosted Required gate for the exact F7 PR head and the packaged 30-long-Note reality-check remain pending. Exact hosted provenance will be recorded on #757. This section records intentional absence where signals remain unmeasured, not a pass for them.

## Standing probe route

The scenario is reachable through the existing rich-card probe without changing its frozen v1 fixture, 16×3 run set, raw schema, or retained artifacts:

```sh
EIDO_RICH_CARD_MODE=probe \
EIDO_RICH_CARD_PROBE_SCENARIO=many-long-notes-reading \
npx playwright test --config playwright.performance.config.ts src/performance/richCardBaseline.perf.ts
```

This command was intentionally not run for #751. When manually invoked, use `playwright.performance.config.ts` as-is so its disposable browser-development data path remains authoritative; do not point it at a real Profile or legacy save.
