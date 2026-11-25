# Eido Documentation

This directory separates current product and engineering guidance from
point-in-time evidence. Start with the smallest authority that answers the
question; research and archives explain how Eido arrived here, but they do not
override current source, foundations, or accepted decisions.

## Current guidance

| Area | Start here | Purpose |
| --- | --- | --- |
| Product language | [`../CONTEXT.md`](../CONTEXT.md) | Canonical domain terms, product model, and performance principles. |
| Architecture | [`foundations/README.md`](foundations/README.md) | The canvas, semantic-context, execution, and supporting persistence boundaries. |
| Decisions | [`adr/README.md`](adr/README.md) | Accepted architectural decisions and their status. |
| Codebase | [`codebase/STRUCTURE.md`](codebase/STRUCTURE.md) | Source layout, stack, architecture, integrations, conventions, testing, and known concerns. |
| Design | [`design/README.md`](design/README.md) | Approved design system, living prototypes, and supporting Mod design records. |
| Open-source operation | [`agents/open-source-handover.md`](agents/open-source-handover.md) | Free/BYOK direction, remaining owner costs, and external shutdown boundary. |
| Agent operations | [`agents/README.md`](agents/README.md) | Repository-specific delivery, CI, model-routing, tracker, and installed `eido` CLI guidance. |
| Release proofs | [`release/README.md`](release/README.md) | Platform signing-smoke runbooks and their non-promotable boundaries. |

## Evidence and history

| Area | Purpose |
| --- | --- |
| [`retros/README.md`](retros/README.md) | Delivery retrospectives and point-in-time review artifacts. |
| [`archive/README.md`](archive/README.md) | Superseded plans, original intent artifacts, and completed learning material. |
| [`../research/README.md`](../research/README.md) | Numbered research tracks, experiments, and decision evidence. |

## Authority order

When documents disagree, prefer current source and tests, then accepted ADRs
and foundation docs, then codebase/design guidance. Treat research,
retrospectives, and archived material as historical context unless a current
document explicitly adopts their conclusion.
