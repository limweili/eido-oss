# 01 — Architecture & Stack

Realises **Concept 1 (one graph, three views)** as concretely as possible, and picks tools that keep us fast now without trapping us later.

## The shape

```
                       ┌─────────────────────────────────────────┐
                       │            THE GRAPH CORE                 │
                       │   (canvas-agnostic, the actual product)   │
                       │                                           │
                       │   graph store ── cards, blocks, conns,    │
                       │      (Zustand)    mods, outputs, runs      │  ← single source of truth
                       │        │                                  │     persisted locally
                       │        ├── compiler   (semantic view)     │
                       │        └── run engine (execution view)    │
                       └───────────────┬───────────────────────────┘
                                       │ renders / edits
                            ┌──────────┴──────────┐
                            │     CANVAS VIEW      │   ← swappable
                            │  React Flow (now)    │      (tldraw later)
                            │  cards as HTML,      │
                            │  custom connections  │
                            └─────────────────────┘
```

**The load-bearing decision:** the *graph core* — data model, store, compiler, run engine — knows nothing about React Flow. The canvas is a thin layer that reads the graph and sends edits back through store actions. This is the seam that lets us start cheap and graduate the canvas without rebuilding the product. (Research 2: *render the graph, don't be the graph.*)

## The three views, mapped

| View | What it is | Where it lives | Concept |
|---|---|---|---|
| **Canvas** | Arrange and connect; what the user sees and shapes. | `canvas/` (React Flow) | 1, 6 |
| **Semantic** | Turn connected thought into a structured instruction; explain why. | `brain/compiler.ts` | 3 |
| **Execution** | Run a card (and later a path); produce versioned outputs; record what happened. | `brain/runEngine.ts` + run records | 5 |

All three read and write the one store. No second source of truth.

## The stack (CTO calls)

| Layer | Choice | Why | Graduation path |
|---|---|---|---|
| Language | **TypeScript** | The whole canvas/AI ecosystem is TS. | — |
| App/build | **Vite + React** | Fastest to a running local app; trivial to throw away. | — |
| Canvas | **React Flow (`@xyflow/react`)**, MIT | Eido's atoms *are* typed cards + typed connections; cards are HTML so text editing is free; custom connections carry strength/polarity. | **tldraw** when line-level anchors, Thought frames, and version stacks start fighting React Flow — see [05](05-build-path-and-open-questions.md). The graph core survives the swap. |
| Graph store | **Zustand** | One small reactive store = the "one graph"; React Flow already uses it internally. | `@tldraw/store` if/when we adopt tldraw. |
| Local saving | **IndexedDB** via a tiny helper | Local-first, reload-safe, offline. | Yjs + `y-indexeddb` when sync is actually needed (designed-for, not built). |
| Note text | **Plain auto-growing text now, stored as blocks** | A textarea tests the loop quickly, but line identity is only best-effort until the editor preserves blocks across edits. | TipTap/ProseMirror when rich text + live line anchors matter. |
| AI | **OpenRouter only**, following the [OpenRouter quickstart](https://openrouter.ai/docs/quickstart) | One model gateway, one key flow, one request shape. Use OpenRouter model slugs (default can start with the quickstart's `~openai/gpt-latest`) and streaming when implemented. | Change models by changing the OpenRouter model slug; do not add provider-specific SDKs in v3. |
| Styling | **Plain CSS / CSS modules** | No design-system overhead for a prototype. | — |

Intended dependencies, minimal: `react`, `react-dom`, `@xyflow/react`, `zustand`, an IndexedDB helper, `nanoid`, `vite`, `typescript`. Use direct `fetch` to OpenRouter's `/api/v1/chat/completions` endpoint first; add `@openrouter/sdk` only if the implementation needs typed wrappers.

## Local-first & the AI call

- The board saves automatically in the browser and survives refresh. Everything works offline **except** the moment of the AI call.
- **The only network egress is the AI call.** No accounts, no cloud, no remote database.
- **API key:** for a personal local prototype, the user pastes an OpenRouter key; it stays in the browser only. Plain-language caveat in the UI: *"Your key stays on this computer. Don't use this in a shared or hosted app."* If browser calls are blocked, the fallback is a tiny local-only proxy that still sends OpenRouter-shaped requests.

## Folder layout (intended, inside `app/`)

```
app/
  index.html
  src/
    main.tsx                 # mount; load saved board before first render
    App.tsx                  # layout: board + minimal top bar + side panel

    graph/                   # THE CORE — no canvas library imported here
      store.ts               # Zustand: cards, connections, mods, outputs, runs + actions
      types.ts               # the property graph shapes (see 02-data-model)
      save.ts                # load/save board <-> IndexedDB, debounced
      graphHelpers.ts        # neighbours, incoming connections, ordering

    brain/                   # THE PRODUCT
      compiler.ts            # gatherConnectedThought() -> structured instruction (Concept 3)
      runEngine.ts           # runCard(), later runPath() (Concept 5)
      applyMods.ts           # how Mod controls modify compiled context (Concept 4)
      openRouter.ts          # OpenRouter quickstart-shaped request + streaming
      provenance.ts          # what each output version remembers

    canvas/                  # SWAPPABLE renderer
      Board.tsx              # <ReactFlow> wired to the store via thin adapters
      cards/                 # NoteCard, AskAiCard, ResultCard, ModCard
      connections/           # WeightedSignedConnection (thickness, dashes, direction)
      ContextPeek.tsx        # "show me what AI used" — the real compiled instruction
      SidePanel.tsx          # edit selected connection / card

    shared/
      ids.ts, words.ts       # nanoid; the user-facing wording (single source for copy)
```

**Data-flow rules (keep it honest):**
1. All changes go through store actions; the canvas's change handlers are thin adapters.
2. Saving is a store subscription — debounce, serialise, write. Hydrate before first render.
3. Compiler and run engine are **read-mostly** — they read the graph and write back only outputs, versions, and run records via store actions.
4. The AI call is the only async boundary and the only network call.

## Why this is enough, and extensible

It's a faithful miniature of the real architecture — graph is primary, views are projections — in a few hundred lines, cheap to delete. And every deferred concept has a seam already cut: line anchors (block records plus an editor upgrade path), richer playback (run engine is the only thing that grows), sync (store designed for a CRDT), a richer canvas (graph core is canvas-agnostic). We pay for none of them now.
