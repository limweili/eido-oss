# 06 — Note Content, Capture & Spatial Infrastructure

The supporting tech that makes nodes *editable* and the canvas *fast*. Less glamorous than the AI engine, but a bad choice here makes the daily feel miserable.

---

## Rich-text inside nodes

Eido's nodes are notes — not labels. They need real editing: formatting, lists, links, maybe embedded media, and "each line/paragraph can become its own node" (your idea: *drag a paragraph as a connection*). That demands a structured, block-aware editor, not a `<textarea>`.

| Editor | Foundation | Verdict for Eido |
|--------|-----------|------------------|
| **TipTap** | Headless, on **ProseMirror** | **Recommended.** ~1.8M monthly npm downloads; best **Yjs** collaboration story (`y-tiptap`, Hocuspocus); structured block model makes "promote a paragraph to a node" tractable; supports *pure decorations* (style without mutating the doc — useful for highlighting AI-suggested connections). |
| **ProseMirror** | Low-level | Maximum control, hard to master. TipTap is the friendlier wrapper — use it unless you need raw PM. |
| **Lexical** | Meta's framework | Fast, modern, but **collaboration is weaker**: its Yjs binding hardcodes the root node → effectively **one editor per Yjs doc**, and decorations are limited ([liveblocks editor comparison 2025](https://liveblocks.io/blog/which-rich-text-editor-framework-should-you-choose-in-2025)). Awkward when every node is its own little editor sharing one document. |
| **BlockNote** | On ProseMirror | Notion-style block editor with Yjs support out of the box — worth a look if you want block-dragging UX cheaply. |

**Why this matters for the graph:** ProseMirror's document model is itself a tree of nodes. "Each line can be a node, each node a connection" maps cleanly onto PM block nodes → Eido graph nodes. This alignment is a reason to favor the ProseMirror family (TipTap/BlockNote) over Lexical.

**Recommendation:** **TipTap**, bound to the same **Yjs** doc that holds your graph. One CRDT, two views (canvas + text).

---

## Capture: voice notes & "inbox"

Your feature list includes **voice notes** and *"inspiration can come from anywhere, any time."* Capture friction is an existential risk (your kill-list: *"easier to just use pen and paper"*).

- **Voice → text:** Whisper-family / frontier speech models, or the browser **Web Speech API** for zero-infra live dictation (quality/locale varies; a server-side transcription model is more reliable). Treat a voice note as a node with both audio asset + transcript.
- **Quick capture is a product primitive, not a feature:** a global hotkey / share-target / menu-bar capture that drops a fragment onto an "inbox" region of the canvas to be connected later. This is a strong argument for the **Tauri** wrapper (global shortcuts, OS share integration) once you go native ([02](02-languages-and-shells.md)).
- **Handwriting/drawing:** your doc scopes this **out** (complexity, no AI feedback loop). Agreed — defer. If revisited, it pushes toward native ink ([02](02-languages-and-shells.md)).

---

## Spatial infrastructure — culling, hit-testing, layout

**Pointer 2 from your prompt — viewport culling — resolved.** If you adopt tldraw/React Flow you get culling for free. If you build any custom layer (the edge/indicator layer almost certainly), you need a spatial index.

### Spatial index
- **rbush** — high-performance **R-tree** for 2D bounding boxes; bounding-box queries "hundreds of times faster than looping over all items," with a `collides()` method and JSON import/export ([rbush](https://github.com/mourner/rbush)). The standard choice for JS canvas culling + hit-testing.
- **kdbush** — 5–8x faster *point* indexing, but **static** (no add/remove after build). Use for fixed point sets (e.g. a minimap), not for an editable graph.
- **flatbush** — even faster static version; same static caveat.

Pattern: maintain an rbush index of node/edge bounding boxes → on every frame, query the index with the current camera rect → render only hits. This is exactly what Excalidraw's `isElementInViewport` + memoization does conceptually ([03](03-reference-projects.md)).

### Graph layout (for the "shape it" feel and auto-arrange)
Eido is freeform (user drags), but you'll want optional auto-layout (e.g. "tidy this region," auto-arrange variants, branch-on-autofill):
- **d3-force** — force-directed layout, the canonical organic "mind-map settles into place" feel.
- **elkjs** / **dagre** — layered/hierarchical layout (good for the series-validator and pipeline views).
- **cytoscape.js** — full graph library with many layouts + analysis if you want batteries included.
- At very large scale, force layout is a candidate to push into **Wasm/WebGPU compute** ([01](01-rendering.md), [02](02-languages-and-shells.md)).

### "Drag to autofill / branch a thought"
Your spreadsheet-autofill-for-ideas mechanic = detect a pattern across selected sibling nodes, then generate N variant nodes along a drag vector. Implementation = pattern selection (the compiler from [05](05-ai-context-engine.md)) + a generation call + auto-placing results with a layout helper. Pure product logic on top of the primitives above — no new core tech.

---

## Recommendation

1. **TipTap on a shared Yjs doc** for node content; lean on ProseMirror's block model for "paragraph → node."
2. **rbush** for any custom culling/hit-testing layer (free if you fully adopt tldraw/React Flow).
3. **d3-force / elkjs** for optional auto-layout; defer GPU layout until graphs are large.
4. **Make capture frictionless early** (voice + global quick-capture); it's a primary retention lever, and it's a reason to reach for Tauri sooner rather than later.
