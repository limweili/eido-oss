# 09 — tldraw

> Studied from source: `research/repos/tldraw` (shallow clone, `main`, June 2026). Read-only; nothing built or run.
> **Role for Eido:** the reference (and likely foundation) for the **canvas view** — and, more importantly than the canvas itself, the reference for *"the document is a reactive property-graph of records; the canvas is just one observer of it."* This is the single best embodiment of Eido's **one graph, three views** thesis that exists in open source.

---

## 1. Why tldraw matters to Eido

tldraw is not really "a whiteboard." Internally it is **a reactive, schema-versioned, JSON record database with a canvas renderer bolted on top as one reactive consumer.** That architecture — not the drawing — is what Eido should learn from. Shapes are nodes, bindings are edges, the store is the graph, and rendering/culling/selection are all *derived* reactive views. If Eido adopts this shape, the canvas graph, execution graph, and semantic graph can genuinely be one store with three projections.

---

## 2. Architecture map (the package stack)

tldraw is layered so the data model is cleanly separable from the canvas. This matters because **the lower two layers are MIT-licensed and independently usable** (see §7):

| Layer | Package | License | What it does | Eido relevance |
|-------|---------|---------|--------------|----------------|
| Signals | `@tldraw/state` (+ `state-react`) | **MIT** | Fine-grained reactive primitives: `atom`, `computed`, `react`, `transact`; lazy eval, dependency tracking, **history/time-travel via epochs + diffs** | The reactive core Eido needs; usable without the canvas license |
| Records | `@tldraw/store` | **MIT** | Reactive in-memory record DB: typed records, `store.query.records(type)`, `filterHistory`, incremental derivations via `getDiffSince(epoch)`, `RecordsDiff` | This *is* a candidate property-graph store for Eido |
| Schema | `@tldraw/tlschema` | tldraw SDK license | Record/shape/binding type defs, validators, **versioned migrations** | Pattern to copy for long-lived documents |
| Editor | `@tldraw/editor` | tldraw SDK license | `Editor` god-object, camera/viewport, culling, geometry, `ShapeUtil`/`BindingUtil`, tools (`StateNode` state machines) | The canvas engine proper |
| SDK | `@tldraw/tldraw` | tldraw SDK license | Default shapes/tools/UI | Reference, not foundation |
| Sync | `@tldraw/sync(-core)` | tldraw SDK license | Multiplayer over Cloudflare Durable Objects | See [04](04-collaboration-and-local-first.md) |

> **Key seam:** the `Editor` consumes the `store`; the `store` is just observable records. You can read/write the store without the editor, and sync/persist it independently. That separation is the reason the "one graph, three views" idea is feasible.

---

## 3. The data model — it's already a property graph

### Shapes = nodes
Every shape is a JSON record (`packages/tlschema/src/shapes/TLBaseShape.ts`):

```ts
interface TLBaseShape<Type, Props> {
  id: TLShapeId            // "shape:abc"
  typeName: 'shape'
  type: Type               // 'geo' | 'note' | ... | your custom type
  x: number; y: number; rotation: number
  index: IndexKey          // fractional index → cheap z-order reordering
  parentId: TLParentId     // "page:..." OR "shape:..."  ← nesting!
  isLocked: boolean
  opacity: number
  props: Props             // typed, validated, migratable
  meta: JsonObject         // free-form app data, untouched by tldraw
}
```

Two things matter enormously for Eido:
- **`parentId` can be another shape**, not just a page. That's how frames/groups contain children — and it's exactly Eido's **THOUGHT-contains-NOTE** container from your sketch. Containment is free.
- **`props` (typed) + `meta` (free JSON)** gives you a typed core plus an escape hatch. Eido's note content, embeddings, "crystallized" flag, timeline metadata all fit in `props`/`meta`.

### Bindings = edges (this is the headline)
Bindings (`packages/tlschema/src/records/TLBinding.ts`) are first-class records:

```ts
interface TLBaseBinding<Type, Props> {
  id: TLBindingId          // "binding:abc"
  typeName: 'binding'
  type: Type               // 'arrow' | your custom edge type
  fromId: TLShapeId        // directed: source
  toId: TLShapeId          // directed: target
  props: Props             // ← arbitrary edge data
  meta: JsonObject
}
```

**This is a directed, typed edge carrying arbitrary properties** — i.e. a property-graph relationship. Mapping Eido's sketch onto it is almost 1:1:
- weight (slider) → `props.weight: number`
- sign (the ✕ negative edge) → `props.sign: 1 | -1` (or `type: 'negative'`)
- hard/soft, modifier (the coil) → `type: 'support' | 'modifier' | ...`
- direction → already native (`fromId`/`toId`)

Bindings have their own validators and **migration sequences** (`createBindingPropsMigrationIds`) — so edge schemas can evolve safely over years.

### Why this is the find of the whole study
tldraw independently arrived at **nodes-with-typed-props + directed-typed-edges-with-props** — which is the Neo4j property-graph model ([12](12-neo4j.md)) expressed in a reactive in-memory TS store. The canvas model and the graph model are *the same model*. Eido doesn't need to reconcile them; tldraw shows they're identical when done right.

---

## 4. Spine traced: how reactivity, adjacency, and culling actually work

### 4.1 Signals (`@tldraw/state`)
`atom` holds state; `computed` derives lazily and only recomputes when tracked dependencies change; `react`/`reactor` run side effects; `transact` batches. Atoms keep a **history buffer of diffs keyed by a global epoch**, enabling time-travel and *incremental* derivations (consumers ask "what changed since epoch N?"). This epoch+diff mechanism is what makes the next two things efficient.

### 4.2 Incremental adjacency index (`derivations/bindingsIndex.ts`)
This file is the one to internalize for Eido's compiler. It maintains a reactive `Map<ShapeId, Binding[]>` (adjacency list). On first run it builds from scratch; thereafter it calls `bindingsHistory.getDiffSince(lastEpoch)` and **applies only the added/updated/removed bindings** to the previous map. So an adjacency index over *hundreds of connections* updates in proportion to *what changed*, not the whole graph — and any reactive consumer (rendering, the context compiler, a minimap) recomputes only when relevant edges move.

> For Eido: your context compiler ([05](05-ai-context-engine.md)) wants exactly this — a live adjacency index it can traverse from a focus node. tldraw shows the incremental-diff pattern that keeps it cheap.

### 4.3 Viewport culling (`derivations/notVisibleShapes.ts` + `Editor.getCulledShapes()` + `hooks/useShapeCulling.tsx`)
A three-part, fully reactive pipeline:
1. `notVisibleShapes` derivation: get `viewportPageBounds`, query `getShapeIdsInsideBounds(...)` (backed by an internal **spatial index** for O(visible) bounds queries), diff against all shape ids → set of off-screen ids. Fast-paths when everything is visible; reuses the previous Set object when contents are unchanged so consumers can use `===`.
2. `getCulledShapes()` (a `@computed`) subtracts the **editing** shape and **selected** shapes (you never cull what the user is touching), and again returns the *same Set instance* when unchanged to avoid re-renders.
3. `ShapeCullingProvider`: a single centralized reactor toggles `display: none` on each shape's DOM container — **shapes are HTML/DOM elements, culled by hiding**, rather than re-painted.

> Two lessons for Eido: (a) culling is just a reactive set-difference against a spatial bounds query — cheap and incremental; (b) tldraw confirms the **DOM-for-cards** model from [01](01-rendering.md): editable shapes live in the DOM (so rich text/IME/selection "just work") and scale is managed by hiding off-screen nodes + an immediate-mode layer for overlays.

### 4.4 Extension surface
- **`ShapeUtil`** (`editor/shapes/ShapeUtil.ts`): per-type class defining geometry, `component()` render, indicator, hit-testing, handles, `canCull`, export. Eido's "note", "module", "output-stack" each become a `ShapeUtil`.
- **`BindingUtil`** (`editor/bindings/BindingUtil.ts`): lifecycle hooks (`onAfterChangeFromShape`, etc.) that keep edges consistent when endpoints move/resize/delete. Eido's weighted/negative/modifier connections become `BindingUtil`s.
- **Tools** are `StateNode` state machines — relevant later for Eido's connect/drag/weight-slider interactions.

---

## 5. Persistence, schema migration, sync (brief)
- **Snapshots:** `getSnapshot`/`loadSnapshot` serialize the whole store (records are JSON). Local-first persistence is a matter of writing snapshots/diffs to IndexedDB.
- **Migrations:** every record and props set has a versioned migration sequence; old documents are migrated forward on load. For a notes app users keep for years, this is not optional, and tldraw's pattern is the reference.
- **Sync:** the store is observable, so sync is "stream `RecordsDiff`s." tldraw's own sync uses Cloudflare Durable Objects (one per document, ~50 peers). The store can equally be bridged to Yjs (see [04](04-collaboration-and-local-first.md)). Eido stays single-player/local-first first; the model doesn't change when multiplayer arrives.

---

## 6. What to extract for Eido (patterns, in priority order)

1. **Records-as-graph:** model Eido's whole document as typed records — `note` shapes (nodes) + typed `binding` edges — with `props` (typed) + `meta` (free). This single decision makes the three views one model.
2. **Incremental reactive adjacency index** (`bindingsIndex` pattern): the substrate the context compiler traverses; updates by diff, not rebuild.
3. **`parentId`-based containment** for THOUGHT→NOTE→line nesting, instead of inventing a separate grouping concept.
4. **Reactive culling = spatial-bounds query + set diff + DOM hide**; return stable Set identities to suppress re-renders.
5. **Versioned migrations from day one** for long-lived idea documents.
6. **Signals (`atom`/`computed`/`react`/`transact`) with epoch+diff history** as the reactivity + undo/redo + "idea evolution timeline" engine.

---

## 7. Licensing & feasibility (decide deliberately)

- **`@tldraw/state` and `@tldraw/store` are MIT** (confirmed in `packages/state/README.md`: "This project is licensed under the MIT License… The tldraw SDK is provided under the tldraw license"). **Eido could adopt the MIT signals + reactive-record store independently of the canvas**, getting the property-graph store + reactivity + history without any commercial license. This is a genuinely useful, low-risk option.
- **`@tldraw/editor` and `@tldraw/tldraw` (the canvas SDK) require a commercial license** for commercial use (`LICENSE.md`: "Alternative licenses are available… contact sales"). Shipping Eido's canvas *on the tldraw editor* is a paid decision — flagged as an open product call in [README](README.md) and [07](07-architecture-decisions.md).
- **Feasibility:** monorepo builds with Yarn 4 (per `AGENTS.md`); we did not build it. Everything above came from reading source + package READMEs, which was sufficient.

---

## 8. Verdict (CTO take)

tldraw is the **architectural north star for Eido's data model**, independent of whether we license its canvas. The thing to copy unconditionally: *model the document as a reactive property-graph of JSON records (nodes + typed edges with props), with an incremental adjacency index and reactive derivations for every view.* That is the spine the rest of Eido hangs on.

Two clean paths fall out:
- **Path A (buy the canvas):** license the tldraw editor; map note→`ShapeUtil`, connection→`BindingUtil`; fastest route to a best-in-class canvas, with the property-graph model for free.
- **Path B (MIT-only):** take `@tldraw/state` + `@tldraw/store` (MIT) as Eido's reactive graph engine, and render with React Flow / a custom layer ([03](03-reference-projects.md)). More work on the canvas, zero canvas-license cost, same data-model benefits.

Either way, the binding (edge) record is the natural home for Eido's weight/sign/type — the part of your sketch that looked custom is, structurally, a solved problem here. Selection between Path A/B belongs to the later combination pass, not this study.
