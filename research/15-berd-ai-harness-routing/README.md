# 15 — BERD AI harness routing

Status: point-in-time primary-source research, completed 2026-08-22.

Question: how does BERD install, validate, and route persistent chats across Goose, Claude Code, Codex, and other agent harnesses, and which parts should Eido adopt without weakening its graph-owned execution model?

Source boundary:

- BERD source at commit [`874e078c931c14386a7d2e16cfe3b32cdbe295e0`](https://github.com/block/berd/tree/874e078c931c14386a7d2e16cfe3b32cdbe295e0).
- Read-only forensics of `/Applications/Berd.app` version 0.6.2.
- First-party Claude Code, Codex, ACP bridge, and Goose sources current or pinned as recorded in doc 07.
- Eido source at commit `02a4b11fd02682e48020bf221155a57d2c534527`.

The local BERD checkout lives under `research/repos/berd/` and is gitignored. It is evidence input, not part of this track.

| Doc | Purpose |
| --- | --- |
| `01-provider-adapters.md` | BERD's harness/provider/model vocabulary, managed bridge supply chain, broker, capability matrix, and adapter lessons. |
| `02-chat-routing-and-runtime.md` | End-to-end chat trace: preparation, ACP prompt, stream reduction, replay, cancellation, and CLI sends. |
| `03-install-discovery-auth.md` | Install, Doctor discovery, readiness, PATH/shell, authentication, and backend-owned setup. |
| `04-installed-app-forensics.md` | Signed 0.6.2 bundle inventory and source/package comparison without launching the GUI or reading app data. |
| `05-eido-current-architecture.md` | Eido's current provider-neutral run seam, direct CLI adapters, Agent Gateway boundary, and comparison points. |
| `06-failure-modes-and-tests.md` | Evidence-ranked non-obvious failures from source, tests, commits, and BERD PR history. |
| `07-upstream-harness-contracts.md` | First-party Claude Code, Codex, Goose, and ACP contract comparison. |
| `08-adversarial-review.md` | Adversarial check for overclaims, version drift, Eido invariant conflicts, and adoption order. |
| `09-synthesis-and-recommendations.md` | Founder-facing conclusion: what BERD actually does, where Eido already differs for good reasons, and a staged adoption path. |

The central conclusion is not that Eido should replace its direct one-shot CLI adapters with Goose. BERD's strongest transferable idea is the depth of its boundary: a curated target identity, managed or explicitly external install provenance, readiness and capability state, acknowledged session routing, normalized events, and conservative recovery. Eido can adopt most of that around its existing run engine. A persistent ACP session broker should be earned by a product need for harness-native sessions or richer bidirectional events.
