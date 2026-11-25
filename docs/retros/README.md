# Retros

Post-run retrospectives from orchestrated multi-agent work on this repo,
grouped for easy browsing.

## Structure

| Folder | Contents |
| --- | --- |
| [`epics/`](epics/) | One living or completed retro per epic: observed friction and decisions during the run, then what shipped, root causes, and adopted rules at close. Living retros must say they are not completion reports. Named `YYYY-MM-DD-epic-<n>-<slug>.md` or stored as `RETRO.md` in a same-named folder. |
| [`skills/`](skills/) | Skill drafts distilled from the retros — decision procedures written so smaller/other AI models can follow them. Drafts live here until promoted to a real skills directory (e.g. `.agents/skills/`). **All four 2026-07 drafts were promoted on 2026-07-07** into `.agents/skills/epic-orchestration/` and `.agents/skills/merge-captain/` (repo specifics: `docs/agents/release-profile.md`); the drafts remain as provenance only. |
| [`reports/`](reports/) | Point-in-time artifacts referenced by the retros (architecture reviews, perf work-stream reports, etc.). |

## Index

### Epics
- **[2026-07-23 — Epic #749: text-heavy Board performance](epics/2026-07-23-epic-749-text-heavy-board-performance/RETRO.md)** — living, not a completion report; F1/F3/F4/F5 are landed, while F7 closeout and the founder's packaged 30-long-Note verdict remain pending.
- **[2026-07-18 — Epic #491: app-wide design system](epics/2026-07-18-epic-491-design-system/RETRO.md)** — completed delivery retro covering the validation bottleneck, risk-led proof reset, design and renderer integration, founder intervention, and adopted delivery rules.
- **[2026-07-19 — Codebase simplification program](epics/2026-07-19-codebase-simplification/RETRO.md)** — live opportunity ledger and delivery retro for the behavior-preserving review of every material area: eight ranked tickets, ownership exclusions, eight independently reviewed refactors, exact-base merge evidence, and the marginal-value stop decision.
- **[2026-07-14 — Epic #410: rich-card rendering architecture](epics/2026-07-14-epic-410-rich-card-rendering/RETRO.md)** — append-only friction ledger and final synthesis covering the benchmark, candidate prototypes, selected architecture, cold-data decision, production sequence, and delivery-process lessons.
- **[2026-07-07 — Epic #247: image compression (merge train)](epics/2026-07-07-epic-247-image-compression/RETRO.md)** — landing a codex-built epic into production: stale handoff instructions, a checkless PR, a cross-epic conflict hotspot, main-CI pacing, and the merge-train runbook v2 with the founder's exact trigger sentence. Companion skill draft: merge-captain.
- **[2026-07-07 — Epic #236: follow-up threads (merge endgame)](epics/2026-07-07-epic-236-follow-up-threads/RETRO.md)** — two stacked PR trains (#243→#250→#266, #285→#288), the base-deletion incident that closed #250 mid-train, why stacked PRs had zero CI, merge-train runbook v3, and the founder trigger sentence. Includes a companion skill draft.
- **[2026-07-07 — Epic #259: connections rework](epics/2026-07-07-epic-259-connections-rework/RETRO.md)** — full lifecycle retro (fuzzy feeling → PM review → grilling → ADRs/PRD → 6 phases → Phase 1 merged): ADR-collision root cause, merge runbook for "go merge epic X", founder-input guide. Includes a companion skill draft.
- **[2026-07-08 — Epic #259: connections rework (merge endgame)](epics/2026-07-07-epic-259-connections-rework/RETRO-merge-endgame.md)** — the downstream half of #259: Phases 2–6 + docs reconciled and squash-merged as a six-deep stack, the merge-captain pairing that caught a "MERGEABLE ≠ merge-ready" near-miss, same-vendor review after Claude usage was exhausted, reconciliation-as-reviewable-work, and full close-out. Companion to the lifecycle retro above.
- **[2026-07-07 — Epic #203: canvas interaction](epics/2026-07-07-epic-203-canvas-interaction.md)** — 11 sub-issues (#204–#214), 11 PRs, merge-train protocol, coordinator playbook for a non-technical maintainer.
- **[2026-07-06 — Epic #182: orchestrated fanout](epics/2026-07-06-epic-182-orchestrated-fanout.md)** — 12 sub-issues (#183–#194), characterization-test pinning, cross-vendor review, merge-operator pattern.

### Skills
- **[merge-captain (draft)](skills/skill-draft-merge-captain.md)** — how to mutate production state safely when the human can't verify anything technical: trust state not reports, classify signals (verified-now/stale/absent), preserve-before-mutate, serialize merges, bounded autonomy, failure taxonomy. Written for smaller/other models.
- **[live-state-operator (draft)](epics/2026-07-07-epic-236-follow-up-threads/skill-draft-live-state-operator.md)** — the decision layer under merge/orchestration work: intent vs derived state, reversibility gating, silence ≠ green, stop-on-surprise containment, mid-run lesson propagation, disposable proof environments, escalation boundary.
- **[complex-epic-lifecycle (draft)](epics/2026-07-07-epic-259-connections-rework/skill-draft-complex-epic-lifecycle.md)** — the upstream + downstream halves: evidence sweeps, taste extraction under a question budget, decisions-as-committed-docs, phase decomposition, merge close-out, founder interface.
- **[epic-orchestration (draft)](skills/skill-draft-epic-orchestration.md)** — how the coordinator thinks: preflight, slicing, dispatch contracts, adversarial review, merge train, failure taxonomy, human interface.

### Reports
- [Epic #749 canvas ownership founder review — 2026-07-23](reports/2026-07-23-epic-749-canvas-ownership-review.html) — standalone pre-PR review separating merged 600K/starvation behavior from the enabled O10, mixed-marquee, and fill-only silhouette repair; includes four founder checks, exact evidence, and the V/P/O/L/S ownership model.
- [Codebase simplification founder review — 2026-07-19](reports/2026-07-19-codebase-simplification-review.html) — standalone delivery review covering risk-ranked opportunities, measured deletion, behavior-preservation evidence, deliberate exclusions, and the live-retro synthesis.
- [Epic #410 founder review — 2026-07-18](reports/2026-07-18-epic-410-founder-review.html) — standalone, interactive delivery review covering impact, technical decisions, implementation boundaries, and the final process retro; comments can be saved into the HTML and returned for action.
- [Architecture review — 2026-07-06](reports/architecture-review-20260706.html)

## Conventions

- Every epic retro ends with concrete, adoptable rules — not observations.
- Cross-link each retro to its predecessor so the playbook lineage is traceable.
- Docs-only changes here are committed directly to `main` (no PR needed);
  anything touching code/tests/config still goes through the PR + review lane.
