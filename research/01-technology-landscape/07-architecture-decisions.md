# 07 — Architecture Decisions & Synthesis

Pulls the threads together: resolves the three bottlenecks from your prompt, names the genuinely-open decisions, and proposes a phased stack to test the *idea* (not the rendering) as fast as possible.

---

## The three bottlenecks from your prompt — resolved for Eido

### Pointer 1 — Retained vs Immediate mode
**Resolved: hybrid, and it's mostly decided for you by adopting an SDK.** Eido's notes are editable text → DOM/retained (React Flow renders nodes as HTML; tldraw overlays DOM where needed). The many-cheap-things layer — connections, indicators, minimap, marquee — → immediate (Canvas2D, or WebGL/WebGPU at scale). Even tldraw is migrating overlays SVG→Canvas2D for 25x gains, confirming the hybrid is the mature answer. **Don't agonize over a single rendering API; adopt the hybrid via an SDK.** ([01](01-rendering.md), [03](03-reference-projects.md))

### Pointer 2 — Viewport culling
**Resolved: free if you adopt tldraw/React Flow; otherwise rbush.** The proven pattern (Excalidraw): spatial-filter to visible elements (`isElementInViewport`), **memoize** the filter on camera params + a scene version nonce, throttle redraws with `requestAnimationFrame`, cache per-element renders. Use **rbush** (R-tree) as the index for any custom layer. ([06](06-text-input-and-spatial-infra.md))

### Pointer 3 — Local-first
**Resolved: CRDT + IndexedDB, single-player first.** Process all input on local state instantly; persist to IndexedDB (`y-indexeddb`); defer any sync server. The same CRDT gives you offline, multi-device, eventual multiplayer, *and* the version history your "idea evolution = context" thesis needs. ([04](04-collaboration-and-local-first.md))

---

## The genuinely open decisions (need *you*, not more research)

| # | Decision | Options | Why it's a fork |
|---|----------|---------|-----------------|
| 1 | **Distribution** | Web/PWA first → Tauri later · vs native-first | Drives language/runtime. Recommend web-first. ([02](02-languages-and-shells.md)) |
| 2 | **Canvas SDK** | tldraw (pay license) · React Flow (MIT, node-model) · build on Excalidraw patterns | License + whether your model is "whiteboard" or "node-graph." ([03](03-reference-projects.md)) |
| 3 | **Canvas *feel*** | Freeform whiteboard (creating) · Structured node-graph (diagramming) | You explicitly want "creating, not diagramming" — but your *data* is node/edge. Tension to resolve in UX. |
| 4 | **Context compiler stance** | Deterministic/explainable · Embedding-automatic · Hybrid | The core IP & product-feel decision. Recommend deterministic-first + opt-in semantic assist. ([05](05-ai-context-engine.md)) |
| 5 | **CRDT** | Yjs (ecosystem) · Automerge (history model) · Loro (speed) | History richness vs ecosystem maturity. Recommend Yjs to start. ([04](04-collaboration-and-local-first.md)) |

Decision 4 is the one that determines whether Eido is *a product* or *a nicer whiteboard*. Spend disproportionate thought there.

---

## Provisional recommended stack (a hypothesis to prototype against)

```
┌─────────────────────────────────────────────────────────────┐
│  SHELL      Web / PWA  →  Tauri 2 (desktop + mobile later)    │
├─────────────────────────────────────────────────────────────┤
│  LANGUAGE   TypeScript + React        (Rust/Wasm only later)  │
├─────────────────────────────────────────────────────────────┤
│  CANVAS     React Flow (MIT)  OR  tldraw (if license OK)      │
│             nodes = HTML cards · edges = weighted connections │
│  + custom   rbush culling/hit-test on any bespoke layer       │
│  + layout   d3-force / elkjs (optional auto-arrange)          │
├─────────────────────────────────────────────────────────────┤
│  NODE TEXT  TipTap (ProseMirror), bound to the Yjs doc        │
├─────────────────────────────────────────────────────────────┤
│  STATE      Yjs CRDT  +  y-indexeddb (local-first, offline)   │
│  SYNC       none v1 → Liveblocks or Hocuspocus when multiplayer│
├─────────────────────────────────────────────────────────────┤
│  AI ENGINE  ◆ Graph model: nodes + weighted/signed/typed edges│  ← YOUR IP
│             ◆ Context compiler: subgraph → budgeted prompt    │
│               (distance-decay + edge weights + negative=∅/constraint)│
│             ◆ Vector store (sqlite-vec/LanceDB) for opt-in    │
│               semantic suggestion                             │
│             ◆ Playback/automation: thin graph-execution layer │
│               (LangGraph-style semantics) over the same graph │
│             ◆ LLM call: swappable, latest frontier model      │
└─────────────────────────────────────────────────────────────┘
```

**Why this stack:** it spends ~zero novel effort on solved problems (rendering, culling, CRDT, text editing — all adopted) and concentrates *all* invention on the context compiler and playback engine, which is the only place Eido can win. It's also incrementally native-izable (Tauri) and incrementally multiplayer (Yjs sync) without rewrites.

---

## Suggested phasing (validate the idea, not the tech)

1. **Spike — the compiler, headless.** No canvas. Hard-code a small graph (nodes + weighted/negative edges) in JSON, build the context compiler, and feel whether weighted-connection→generation actually "reads your mind." *This is the riskiest assumption; test it first, cheapest.*
2. **Canvas MVP.** React Flow (or tldraw) + TipTap nodes + Yjs/IndexedDB. Manual connect, weight slider, single "generate from this node's context" action. Single-player, local-only.
3. **Connection semantics.** Negative edges as constraints, hard/soft types, "drag paragraph → node," crystallized components, history/timeline view.
4. **Playback.** Series / parallel / loop execution over a path (your validator, persona-panel, debate-loop examples).
5. **Scale & polish.** Culling tuning, optional auto-layout, semantic suggestion assist, then multiplayer/sync and Tauri packaging *if* the idea has proven itself.

The ordering deliberately front-loads the **unbuyable, highest-risk** part (the compiler) and defers every commodity decision until the idea is proven.

---

## What would kill the project (your kill-list, mapped to architecture)

| Risk you named | Architectural mitigation |
|----------------|--------------------------|
| Too complex | Adopt SDKs for everything non-core; keep the *visible* surface minimal; deterministic/explainable compiler over opaque magic. |
| Over-generation / review > creation | Compiler is *precise & explainable*; AI *suggests connections*, doesn't dump content; generation is always scoped to a focus + budget. |
| "Easier to use pen and paper" | Frictionless capture (voice, global hotkey, Tauri) + instant local-first responsiveness (no spinners). |
| Helps thinking but goes nowhere | Make the **output node** and "turn loose idea → concrete output" a first-class, always-present destination, not an afterthought. |
