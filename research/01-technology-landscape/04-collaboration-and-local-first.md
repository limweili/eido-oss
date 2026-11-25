# 04 — Real-Time Collaboration & Local-First Architecture

**Reframing for Eido:** the original prompt treats this as "multiplayer collaboration." But for a *single-user thinking tool*, the more important payoff of this same technology stack is **local-first single-player**: instant local edits, offline capture, durable history, and "time-travel" over how an idea evolved (which your idea doc explicitly calls context: *"ideas have a sense of timeline transformation"*). Multiplayer is a later, optional layer that the same CRDT gives you almost for free.

**Pointer 3 from your prompt, resolved:** yes — process all input on local state instantly (IndexedDB-backed), sync asynchronously in the background. CRDTs make both local-first *and* eventual multiplayer fall out of one model.

---

## CRDTs — the data model

A CRDT (Conflict-free Replicated Data Type) lets independent replicas merge without a central coordinator and without lost updates. Even single-player, it gives you a clean offline + multi-device merge story.

| Library | Language/core | Strengths | Watch-outs |
|---------|--------------|-----------|-----------|
| **Yjs** | JS (no Wasm) | Fastest *mature* JS option; smallest bundle (no Wasm load cost); huge ecosystem (editors, providers, IndexedDB, WebRTC, WebSocket). Battle-tested. | Historically text-editor-centric; tldraw found its text focus "less suitable" for canvas/diagram data ([liveblocks](https://liveblocks.io/blog/tldraw-became-viral-by-converting-its-product-to-multiplayer-using-liveblocks)) — solvable, but model your shape/node data deliberately. |
| **Automerge** | Rust core + Wasm | JSON-like documents + **full Git-like history of every change** (great for your "idea evolution" timeline); multi-language; great DX. | Trades raw speed for history richness; Wasm load cost. v2/v3 closed most of the old perf gap. |
| **Loro** | Rust + Wasm | **Fastest** in 2026 benchmarks across nearly every category; rich features incl. movable tree/list. | Newer/less battle-tested; loses only on initial Wasm load; smaller ecosystem. |

Sources: [pkgpulse Yjs vs Automerge vs Loro 2026](https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026), [velt CRDT libraries](https://velt.dev/blog/best-crdt-libraries-real-time-data-sync).

**Consensus heuristic (2026):** *Pick Yjs unless you specifically need Automerge's history model or Loro's raw performance.* For Eido, Automerge's history model is genuinely attractive given your "timeline of transformation" thesis — worth a serious look — but Yjs's ecosystem (esp. TipTap binding, see [06](06-text-input-and-spatial-infra.md)) makes it the lower-risk start. **You can get versioned history on Yjs too** (snapshots / `y-protocols`), so don't over-index on that single factor.

> ⚠️ Dissent worth knowing: not everyone stays on CRDTs. [PowerSync/Cinapse wrote about moving *away* from CRDTs for sync](https://powersync.com/blog/why-cinapse-moved-away-from-crdts-for-sync) citing memory/complexity at scale. For a graph-of-notes app, CRDTs are still the right default — but if your documents become huge, re-evaluate.

---

## Sync backends — buy vs build

You do **not** want to operate globally-scaled WebSockets yourself early on.

| Option | Type | Notes |
|--------|------|-------|
| **Yjs + providers** (y-websocket, y-webrtc, Hocuspocus) | Self-host/OSS | Full control, no vendor cost; you run the infra. Hocuspocus is the batteries-included Yjs server (from the TipTap team). |
| **Liveblocks** | Managed | Presence, storage, Yjs sync, comments out of the box. Free ≤50 connections, then $99+/mo ([showcase](https://liveblocks.io/showcase/multiplayer-canvas-with-tldraw)). tldraw went viral *because* Liveblocks made it multiplayer in ~weeks. |
| **tldraw sync** | Managed/OSS | tldraw's own recommended sync; each canvas = a Cloudflare **Durable Object** (~50 collaborators each), which sidesteps the central scaling bottleneck. Only relevant if you adopt tldraw. |
| **Automerge + Convex / sync server** | Managed/OSS | [Automerge + Convex](https://stack.convex.dev/automerge-and-convex) is a documented local-first path. |

**Recommendation:** start single-player, **no sync server at all** — just local persistence. When multiplayer matters, add Liveblocks (fastest to ship) or self-host Hocuspocus/y-websocket (cheapest at scale).

---

## Local persistence (the "first" in local-first)

- **IndexedDB** is the browser's durable local store. With Yjs use **`y-indexeddb`**; with Automerge persist the binary doc. Practical ceiling ~hundreds of MB ([buildpilot sync engines](https://trybuildpilot.com/648-electric-sql-vs-powersync-vs-zero-2026)) — fine for a note graph; a concern only if you embed lots of media/assets.
- If you later go native (Tauri), you can back local state with **SQLite** (gigabytes, robust offline) instead of IndexedDB.

## Sync engines (the relational alternative — context, probably not for v1)

If Eido ever needs a server-authoritative relational store synced to clients (e.g. team workspaces, sharing, server-side AI jobs reading the graph), the 2026 landscape:

- **ElectricSQL** (electric-next rebuild, 2024) — Postgres → client sync, increasingly general-purpose.
- **PowerSync** — Postgres → client **SQLite**, robust full-offline; felt more stable in early-2026 evals.
- **Zero / Triplit / InstantDB** — collaborative-SaaS-shaped, realtime multi-user native; Zero caches reads in IndexedDB.

Sources: [BuildPilot 2026](https://trybuildpilot.com/648-electric-sql-vs-powersync-vs-zero-2026), [Smashing Magazine: local-first architecture](https://www.smashingmagazine.com/2026/05/architecture-local-first-web-development/).

**For Eido:** these are heavier than you need at idea stage. A CRDT + IndexedDB *is* your local-first stack. Sync engines become interesting only when you have a relational server-of-record and a team/cloud story.

---

## Recommendation

1. **v1: local-first single-player.** Yjs (or Automerge if the history model wins you over) + IndexedDB. No backend.
2. **Model your graph as CRDT data from day one** (shapes/nodes/edges as CRDT maps) so multiplayer and multi-device "just work" later — retrofitting this is painful.
3. **Defer sync infra.** When needed: Liveblocks to ship fast, or self-hosted Hocuspocus/y-websocket to control cost.
4. **Lean into history.** Your "idea evolution = context" thesis means version/snapshot history isn't a nice-to-have — it's a feature. Whichever CRDT you pick, design for retrievable history early.
