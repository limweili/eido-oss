# Architecture Decision Records

This directory records architecture decisions for Eido. ADRs are short, source-controlled notes that explain which path was chosen, what was deferred, and what trade-offs future agents should preserve unless a new ADR supersedes them. ADRs 0019–0021 establish viewport fidelity and canvas interaction; ADRs 0023–0024 refine Reading residency, hover activation, and image rendition lifecycle without changing that fidelity.

Production note (2026-08-21): ADRs 0019 and 0020 remain accepted for Detail Bands, painter geometry, and interaction invariants. The [Reading-band architecture selection](../../research/03-performance-architecture/19-reading-band-architecture-selection.md) is implemented through ADRs 0023 and 0024: buffered rich-DOM residency, separate Live Card and gesture-proxy authority, a Board-wide safety representation, exactly-once activation, long-Card continuity, graph-complete search and copy, bounded focus/accessibility entry, and visibility-aware image renditions with last-reference-safe eviction. Ordinary cold Passive admission uses deterministic ordered admission within a 600,000-unit per-viewport text-weight ceiling; a separately reported, exact-visible-only pool admits at most 10 Cards individually above 100,000 units. Both share the 540-Card count, remaining weight rejects stay painted without starving later candidates, independently owned Live Cards remain exempt, and direction-aware look-ahead never admits oversize Cards while still idle-prewarming renditions under unchanged budgets. A 30-Card trial was withdrawn after founder testing found 30 simultaneous ~281,000-unit Cards unusable. A default-off packaged readout exposes numeric-only snapshots of these existing authorities without adding graph identity or mutation authority. The saved Board format remains unchanged, and the integrated synthetic load/save/reload/export seam preserves authoritative asset references. No ADR in this set is superseded.

## Accepted Decisions

- [ADR 0001: Event Log As Long-Term Source](0001-event-log-as-long-term-source.md)
- [ADR 0002: Hybrid Local-First Multiplayer](0002-hybrid-local-first-multiplayer.md)
- [ADR 0003: Globally Unique Durable IDs](0003-globally-unique-durable-ids.md)
- [ADR 0004: Hybrid Storage Now, Records And Blobs Later](0004-hybrid-storage-now-records-and-blobs-later.md)
- [ADR 0005: Salvage Local Imports, Strict Sync](0005-salvage-local-imports-strict-sync.md)
- [ADR 0006: AI Agents As First-Class Contract Consumers](0006-ai-agents-as-first-class-contract-consumers.md)
- [ADR 0007: Hand-Written Validators Before Formal Schemas](0007-hand-written-validators-before-formal-schemas.md)
- [ADR 0008: AI Provenance As First-Class Record](0008-ai-provenance-as-first-class-record.md)
- [ADR 0009: Local-First With Optional Cloud](0009-local-first-with-optional-cloud.md)
- [ADR 0010: Massive Boards And History Before User Scale](0010-massive-boards-and-history-before-user-scale.md)
- [ADR 0011: One Graph, Three Views](0011-one-graph-three-views.md)
- [ADR 0012: Context Layer As Deterministic Graph Queries](0012-context-layer-deterministic-queries.md)
- [ADR 0013: Execution Plans As Data](0013-execution-plans-as-data.md)
- [ADR 0014: Chain Runs Heal What Is Stale](0014-chain-runs-heal-what-is-stale.md)
- [ADR 0015: Context Budgets Compact Before Dropping](0015-context-budgets-compact-before-dropping.md)
- [ADR 0016: State-First Runs, Split Undo/Playback, Event-Aware Commit Funnel](0016-state-first-runs-split-undo-playback-event-aware-commit.md)
- [ADR 0017: Context Contracts Per Card Kind](0017-context-contracts-per-card-kind.md)
- [ADR 0018: Negative Connections Are Anti-Context](0018-negative-connections-are-anti-context.md)
- [ADR 0019: Viewport-Derived Detail Bands](0019-viewport-derived-detail-bands.md)
- [ADR 0020: Board-Space Shapes, Screen-Space Labels](0020-board-space-shapes-screen-space-labels.md)
- [ADR 0021: Visual Decay Removed from the Render Path](0021-visual-decay-removed.md)
- [ADR 0023: Buffered Passive Cards And Hover Activation](0023-buffered-passive-cards-and-hover-activation.md)
- [ADR 0024: Image Renditions Are Derived And Visibility-Aware](0024-image-renditions-are-derived-and-visibility-aware.md)
- [ADR 0025: SQLite Profile Authority, Blobs, and Portable Exports](0025-sqlite-profile-authority-blobs-and-portable-exports.md)
- [ADR 0026: Agent Gateway Uses Validated Domain Commands](0026-agent-gateway-uses-validated-domain-commands.md)
- [ADR 0027: Semantic Vector Indexes Are Derived and Deferred](0027-semantic-vector-indexes-are-derived-and-deferred.md)
- [ADR 0028: Risk-Proportional Evidence Over Fixed Ceremony](0028-risk-proportional-evidence-over-fixed-ceremony.md)
- [ADR 0029: Electron Main Installs One Profile Authority](0029-electron-main-installs-one-profile-authority.md)
- [ADR 0030: Single-Class Mods Replace The Control Workbench](0030-single-class-mods-replace-the-control-workbench.md)
- [ADR 0031: Live Agent Routing Over a Local Socket, Behind a Two-Transport Shim](0031-live-agent-routing-over-local-socket.md)
- [ADR 0032: Update Delivery Is a Signed Manifest on an Owned Address](0032-update-delivery-is-a-signed-manifest-on-an-owned-address.md) — decision 5 amended by ADR 0039.
- [ADR 0033: Agentic Runs Delegate Tool Use To The Provider](0033-agentic-runs-delegate-tool-use-to-the-provider.md)
- [ADR 0034: One Provider Key Is The Product Default](0034-one-provider-key-is-the-product-default.md)
- [ADR 0035: The Tool Vocabulary Is Open, The Declared Set Is Closed](0035-the-tool-vocabulary-is-open-the-declared-set-is-closed.md)
- [ADR 0036: Eido Runs The Tool Loop](0036-eido-runs-the-tool-loop.md)
- [ADR 0037: A Second Key Buys A Better Reach](0037-a-second-key-buys-a-better-reach.md)
- [ADR 0038: A Long Run Writes Itself A Note](0038-a-long-run-writes-itself-a-note.md)
- [ADR 0039: Squirrel.Mac Owns macOS Bundle Replacement and Relaunch](0039-squirrel-mac-owns-bundle-replacement-and-relaunch.md)
- [ADR 0040: Content Fails Closed, Settings Fail Soft](0040-content-fails-closed-settings-fail-soft.md)

- [ADR 0051: Free Open-Source Eido Uses Only User-Funded Providers](0051-free-open-source-byok-only.md)

Numbering note (2026-08-19): `main` and the monetization epic each assigned
0032 to 0037 in parallel, so the repository briefly held six pairs of duplicate
numbers with unrelated content. `main`'s set kept its numbers because shipped
source comments already cite them; the monetization set moved to 0038 through
0046 (its own 0038 to 0040 shifted to 0044 to 0046 to make room). When two
branches both add ADRs, renumber at merge time and check this index before
claiming the next free number.

Until that merge-time renumbering is complete, references to this epic's ADR
family should use decision titles rather than numeric prefixes. The duplicate
0038 prefix and every later numeric prefix in this family are provisional.


## Superseded Decisions

- [ADR 0022: Mods As The Universal Prompt Surface](0022-mods-as-the-universal-prompt-surface.md) — superseded by ADR 0030; its connection-scoped and frozen-stamp decisions continue there.

Commercial decisions below were superseded on 2026-10-27 by ADR 0051. They are retained only to explain historical code and evidence.

- [ADR 0038: Hosted AI Monetizes Convenience While Basic BYOK Remains Free](0038-hosted-ai-monetizes-convenience-while-basic-byok-remains-free.md)
- [ADR 0040: Hosted AI Is a Control Plane Over Direct OpenRouter Access](0040-hosted-ai-is-a-control-plane-over-direct-openrouter-access.md)
- [ADR 0041: Hosted AI Additional Usage Is Prepaid](0041-hosted-ai-additional-usage-is-prepaid.md)
- [ADR 0043: Stripe Is Billing Authority; Entitlements Are Eido Projections](0043-stripe-is-billing-authority-entitlements-are-eido-projections.md)
- [ADR 0047: The Account Record Decides What Can Be Done; Flags Decide What Is Seen](0047-the-account-record-decides-what-is-done-flags-decide-what-is-seen.md)
- [ADR 0048: BYOK Is Preferred; Managed Fallback Requires Definitive Rejection](0048-byok-is-preferred-managed-fallback-requires-definitive-rejection.md)
- [ADR 0049: Managed Linkup Is an Ephemeral Content Relay](0049-managed-linkup-is-an-ephemeral-content-relay.md)
- [ADR 0050: The Operator Console Is a Narrow Control-Plane Module](0050-the-operator-console-is-a-narrow-control-plane-module.md)
- [ADR 0039: Eido Accounts Are Required Only for Hosted Services](0039-eido-accounts-are-required-only-for-hosted-services.md)
- [ADR 0042: Clerk Owns Hosted Account Authentication](0042-clerk-owns-hosted-account-authentication.md)
- [ADR 0044: The AI Control Plane Runs on a Sydney Google Cloud Stack](0044-the-ai-control-plane-runs-on-a-sydney-google-cloud-stack.md)
- [ADR 0045: Hosted AI Separates Visible Turns From Provider Calls](0045-hosted-ai-separates-visible-turns-from-provider-calls.md)
- [ADR 0046: Account Deletion Freezes First and Erases Through a Resumable Saga](0046-account-deletion-freezes-first-and-erases-through-a-resumable-saga.md)
