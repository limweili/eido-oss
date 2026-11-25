# 07 — Agent CLI

Status: implementation close-out (refreshed 2026-08-21). Source contracts and
focused proof are present; a completed real-provider walkthrough and fresh
paired macOS arm64/Windows x64 certification remain evidence gaps, not inferred
successes. The plain-language [#722 visual walkthrough and feature map](../../docs/retros/reports/2026-08-21-agent-cli-722-walkthrough-guide.html)
is the current handoff for owner review; #722 remains open until that review
and the follow-up PR are landed.

Question: what should Eido's production agent-facing CLI look like, built on the
Local Agent Gateway that landed through #520/#524/#525/#526/#527, using the
learnings from discovery epic #598?

Decision horizon: CLI-first agent access for Friends Alpha era. MCP surface
expansion is deliberately deferred (a thin certified stdio MCP adapter already
exists in production and stays as-is).

| Doc | Purpose |
| --- | --- |
| `01-cli-implementation-scope.md` | Point-in-time repo investigation, decision reconciliation, gap analysis, and the initial ergonomics-only scope. Superseded where doc 02 or shipped source differs. |
| `02-cli-epic-scope.md` | Founder direction (live GUI routing, full surface, spatial placement, AI-attribution visibility, PATH distribution) and the phased epic scope that superseded doc 01's proposal. |
| `03-wal-read-concurrency-evidence.md` | Disposable SQLite measurement showing that ordinary WAL permits a second reader but Eido's retained exclusive owner lock correctly yields `busy` until live-owner routing lands. |
| `03-delivery-retro.md` | Short living delivery retro: friction, decisions, and adopted rules from epic #711. |
| `04-phase-0-fresh-agent-transcript.md` | Bare packaged-command transcript and friction note proving the Phase 0 help path can orient a caller with no prior Eido CLI context. |
| `05-final-static-zero-context-transcript.md` | Independent final package pass using only bare help and static discovery; records the repaired key/downgrade guidance and the explicit no-Profile/no-provider evidence boundary. |
| `06-live-socket-latency-evidence.md` | Disposable production-shaped macOS measurement of the complete packaged live status route and its lower native transport seam. |
| `../../docs/retros/reports/2026-08-21-agent-cli-722-walkthrough-guide.html` | Plain-language visual walkthrough of the CLI, the complete feature map, #722's remaining evidence gate, and the epic tracker status. |

Current operator guidance lives in
[`docs/agents/eido-cli.md`](../../docs/agents/eido-cli.md). Transcript 05 proves
final static discoverability only; it is not the disposable live spatial and
real-provider walkthrough.
