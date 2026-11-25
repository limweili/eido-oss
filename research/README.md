# Research

Research is organized by durable track, not by prototype version. Each track should have a short `README.md`, numbered documents, and an explicit status.

## Tracks

| Path | Purpose |
| --- | --- |
| `01-technology-landscape/` | Initial technology research: rendering, shell/runtime choices, local-first storage, AI context engines, and reference projects. |
| `02-source-studies/` | Hands-on source studies and synthesis across tldraw, Excalidraw, n8n, and Neo4j, plus the point-in-time Toolcraft package intake. |
| `03-performance-architecture/` | Active performance and scale architecture work, including PRDs, baselines, gates, and issue planning. |
| `04-activity-language/` | Exploratory product/design research for turning board activity into recognizable, generated board portraits. |
| `05-production-release/` | Friends Alpha desktop-release research, persistence/recovery policy, autonomous release operations, and the executable #448/#410/#491 dependency contract. |
| `06-sqlite-profile-authority/` | SQLite-backed Profile, Mod-ready persistence, and Local Agent Gateway planning that seeded epic #520. |
| `07-mod-design-prototypes/` | Point-in-time Mod instrument/workbench prototype process retained for provenance. |
| `07-agent-cli/` | Production Agent CLI scope, transport/spatial evidence, Phase 0 transcript, and epic #711 delivery retro. |
| `08-chicken-evolution/` | Point-in-time primary-source synthesis and Eido-ready evidence map for chicken evolution, domestication, introgression, and dispersal. |
| `10-link-preview-url-recognition/` | Scheme-less website recognition research for link-preview paste handling. |
| `10-linkup-web-intelligence/` | Linkup as Eido's primary web search, fetch, and research provider, with OpenRouter server tools kept as fallback. Full API surface plus the seams, reversals, and spikes it implies. |
| `15-berd-ai-harness-routing/` | Point-in-time source study of BERD's managed ACP bridges, Goose broker, chat/session routing, failure handling, and transferable lessons for Eido's local harness providers. |
| `16-bun-1-4-runtime-assessment/` | Point-in-time Bun 1.4 adoption decision for Eido: replacement boundaries, performance estimates, lifetime trade-offs, and a conditional installer-canary gate. |

## How To Add Research

Use a new numbered track when the topic has a different question, audience, or decision horizon from the existing tracks:

```text
research/
  04-topic-name/
    README.md
    01-first-question.md
    02-second-question.md
    assets/
```

Inside a track:

- Keep file names numbered and descriptive.
- Put source assets in `assets/`.
- Keep implementation tickets under `issues/` only when the track turns into planned work.
- Update the track `README.md` when adding, renaming, or superseding a document.
- Record whether claims are current, historical, or point-in-time.

Do not put active app code, private saves, generated build output, or local reference checkouts in research. Local reference repositories belong under `research/repos/`, which is gitignored.


## Local Reference Repositories

These optional checkouts are local-only and ignored by Git:

- codebase-memory-mcp
- excalidraw
- n8n
- neo4j
- penpot
- tldraw
- toolcraft (generated from `@pixel-point/toolcraft@0.0.14`; local evaluation snapshot only)
